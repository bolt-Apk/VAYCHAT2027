/*
# Add notification rate limiting table and update message trigger

1. New Tables
   - `private.notification_rate_limit`
     - `conversation_id` (uuid) - conversation being rate-limited
     - `last_sent_at` (timestamptz) - when the last notification was sent
     - Primary key on `conversation_id`

2. Changes
   - Updated `private.notify_new_message()` to skip sending if a notification
     for the same conversation was sent less than 3 seconds ago
   - This prevents notification spam when multiple messages arrive rapidly
   - Rate limit only applies to regular messages (not calls or story replies)

3. Security
   - Table is in `private` schema, inaccessible from REST API
   - No RLS needed (private schema tables are not exposed)

4. Important Notes
   - 3-second window balances responsiveness with spam prevention
   - The rate limit row is upserted on each send
   - Old rate limit entries are cleaned up after 1 hour
*/

CREATE TABLE IF NOT EXISTS private.notification_rate_limit (
  conversation_id uuid PRIMARY KEY,
  last_sent_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION private.notify_new_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_recipient record;
  v_recipient_ids uuid[];
  v_sender_name text;
  v_sender_avatar text;
  v_conv_name text;
  v_conv_type text;
  v_body text;
  v_title text;
  v_sound text;
  v_notif_settings jsonb;
  v_filtered_ids uuid[] := '{}';
  v_is_story_reply boolean := false;
  v_secret text;
  v_last_sent timestamptz;
BEGIN
  v_is_story_reply := (NEW.status_id IS NOT NULL);

  IF NOT v_is_story_reply AND NEW.message_type NOT IN ('call_started', 'call_ended', 'call') THEN
    SELECT last_sent_at INTO v_last_sent
    FROM private.notification_rate_limit
    WHERE conversation_id = NEW.conversation_id;

    IF v_last_sent IS NOT NULL AND (now() - v_last_sent) < interval '3 seconds' THEN
      RETURN NEW;
    END IF;
  END IF;

  SELECT type, name INTO v_conv_type, v_conv_name
  FROM public.conversations WHERE id = NEW.conversation_id;

  SELECT display_name, avatar_url INTO v_sender_name, v_sender_avatar
  FROM public.profiles WHERE id = NEW.sender_id;

  IF v_sender_name IS NULL OR v_sender_name = '' THEN
    v_sender_name := 'Пользователь';
  END IF;

  UPDATE public.conversation_members
  SET is_muted = false, muted_until = NULL
  WHERE conversation_id = NEW.conversation_id
    AND is_muted = true
    AND muted_until IS NOT NULL
    AND muted_until <= now();

  SELECT array_agg(user_id) INTO v_recipient_ids
  FROM public.conversation_members
  WHERE conversation_id = NEW.conversation_id
    AND user_id != NEW.sender_id
    AND is_muted = false;

  IF v_recipient_ids IS NULL OR array_length(v_recipient_ids, 1) IS NULL THEN
    RETURN NEW;
  END IF;

  IF v_is_story_reply THEN
    CASE NEW.message_type
      WHEN 'text' THEN v_body := 'Ответ на статус: ' || COALESCE(LEFT(NEW.content, 180), '');
      WHEN 'image' THEN v_body := 'Ответ на статус: Фото';
      WHEN 'video' THEN v_body := 'Ответ на статус: Видео';
      WHEN 'voice' THEN v_body := 'Ответ на статус: Голосовое сообщение';
      WHEN 'video_note' THEN v_body := 'Ответ на статус: Видеосообщение';
      WHEN 'sticker' THEN v_body := 'Ответ на статус: ' || COALESCE(NEW.content, 'Стикер');
      ELSE v_body := 'Ответ на ваш статус';
    END CASE;
  ELSE
    CASE NEW.message_type
      WHEN 'text' THEN v_body := COALESCE(LEFT(NEW.content, 200), 'Новое сообщение');
      WHEN 'image' THEN v_body := 'Фото';
      WHEN 'video' THEN v_body := 'Видео';
      WHEN 'voice' THEN v_body := 'Голосовое сообщение';
      WHEN 'video_note' THEN v_body := 'Видеосообщение';
      WHEN 'document', 'file' THEN v_body := 'Файл';
      WHEN 'contact' THEN v_body := 'Контакт';
      WHEN 'location' THEN v_body := 'Геопозиция';
      WHEN 'sticker' THEN v_body := COALESCE(NEW.content, 'Стикер');
      WHEN 'forwarded' THEN v_body := 'Пересланное сообщение';
      WHEN 'call_started' THEN v_body := 'Входящий звонок';
      WHEN 'call_ended' THEN v_body := 'Звонок завершён';
      WHEN 'call' THEN v_body := 'Звонок';
      ELSE v_body := 'Новое сообщение';
    END CASE;
  END IF;

  FOR v_recipient IN
    SELECT p.id, p.notification_settings
    FROM public.profiles p
    WHERE p.id = ANY(v_recipient_ids)
  LOOP
    v_notif_settings := v_recipient.notification_settings;
    IF v_notif_settings IS NOT NULL AND (v_notif_settings->>'messages')::boolean = false THEN
      CONTINUE;
    END IF;
    IF v_conv_type = 'group'
       AND v_notif_settings IS NOT NULL
       AND (v_notif_settings->>'groups')::boolean = false THEN
      CONTINUE;
    END IF;
    v_filtered_ids := v_filtered_ids || v_recipient.id;
  END LOOP;

  IF array_length(v_filtered_ids, 1) IS NULL THEN
    RETURN NEW;
  END IF;

  IF v_conv_type = 'group' AND v_conv_name IS NOT NULL THEN
    v_title := v_conv_name;
    v_body := v_sender_name || ': ' || v_body;
  ELSE
    v_title := v_sender_name;
  END IF;

  v_sound := CASE WHEN NEW.message_type = 'call_started' THEN 'ringtone.caf' ELSE 'default' END;

  v_secret := private.get_push_secret();

  PERFORM net.http_post(
    url := 'https://wdvgbdgklbrileuyweqs.supabase.co/functions/v1/send-push-notification',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_secret
    ),
    body := jsonb_build_object(
      'user_ids', to_jsonb(v_filtered_ids),
      'title', v_title,
      'body', v_body,
      'data', jsonb_build_object(
        'conversation_id', NEW.conversation_id,
        'message_id', NEW.id,
        'sender_id', NEW.sender_id,
        'sender_name', v_sender_name,
        'sender_avatar', COALESCE(v_sender_avatar, ''),
        'conv_type', v_conv_type,
        'conv_name', COALESCE(v_conv_name, ''),
        'message_type', NEW.message_type,
        'type', CASE
          WHEN NEW.message_type = 'call_started' THEN 'call'
          WHEN v_is_story_reply THEN 'story_reply'
          ELSE 'message'
        END,
        'is_story_reply', v_is_story_reply,
        'status_id', COALESCE(NEW.status_id::text, '')
      ),
      'sound', v_sound,
      'categoryId', CASE WHEN v_is_story_reply THEN 'story_reply' ELSE 'message' END
    )
  );

  INSERT INTO private.notification_rate_limit (conversation_id, last_sent_at)
  VALUES (NEW.conversation_id, now())
  ON CONFLICT (conversation_id) DO UPDATE SET last_sent_at = now();

  DELETE FROM private.notification_rate_limit
  WHERE last_sent_at < now() - interval '1 hour';

  RETURN NEW;
END;
$$;

GRANT EXECUTE ON FUNCTION private.notify_new_message() TO postgres;
