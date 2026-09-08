/*
# Enhance push notifications for story replies in chat

## Purpose
When a user replies to someone's story in a chat (message with `status_id` set),
the push notification should clearly indicate it's a story reply, not just a
regular message. This helps the story author understand the context when they
see the notification and navigate to the correct message.

## Changes
1. Update `notify_new_message()` to detect messages with a non-null `status_id`
2. For story reply messages:
   - Title becomes "{sender_name}" (same as DM)
   - Body is prefixed with "Ответ на статус: " followed by the message content
   - Push data includes `is_story_reply: true` for client-side handling
3. All other message types remain unchanged

## Security
- Function remains SECURITY DEFINER with restricted search_path
- No new tables or policies

## Important Notes
1. Only messages with `status_id IS NOT NULL` are treated as story replies
2. The existing navigation flow (conversation_id + message_id) is preserved
3. This works for both direct and group conversations
*/

CREATE OR REPLACE FUNCTION public.notify_new_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
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
  v_preview boolean;
  v_filtered_ids uuid[] := '{}';
  v_is_story_reply boolean := false;
BEGIN
  -- Get conversation info
  SELECT type, name INTO v_conv_type, v_conv_name
  FROM conversations WHERE id = NEW.conversation_id;

  -- Get sender info
  SELECT display_name, avatar_url INTO v_sender_name, v_sender_avatar
  FROM profiles WHERE id = NEW.sender_id;

  IF v_sender_name IS NULL OR v_sender_name = '' THEN
    v_sender_name := 'Пользователь';
  END IF;

  -- Auto-unmute expired mutes and get eligible recipients
  UPDATE conversation_members
  SET is_muted = false, muted_until = NULL
  WHERE conversation_id = NEW.conversation_id
    AND is_muted = true
    AND muted_until IS NOT NULL
    AND muted_until <= now();

  -- Get non-muted recipients (excluding sender)
  SELECT array_agg(user_id) INTO v_recipient_ids
  FROM conversation_members
  WHERE conversation_id = NEW.conversation_id
    AND user_id != NEW.sender_id
    AND is_muted = false;

  IF v_recipient_ids IS NULL OR array_length(v_recipient_ids, 1) IS NULL THEN
    RETURN NEW;
  END IF;

  -- Check if this is a story reply
  v_is_story_reply := (NEW.status_id IS NOT NULL);

  -- Build message body based on type
  IF v_is_story_reply THEN
    CASE NEW.message_type
      WHEN 'text' THEN
        v_body := 'Ответ на статус: ' || COALESCE(LEFT(NEW.content, 180), '');
      WHEN 'image' THEN
        v_body := 'Ответ на статус: Фото';
      WHEN 'video' THEN
        v_body := 'Ответ на статус: Видео';
      WHEN 'voice' THEN
        v_body := 'Ответ на статус: Голосовое сообщение';
      WHEN 'video_note' THEN
        v_body := 'Ответ на статус: Видеосообщение';
      WHEN 'sticker' THEN
        v_body := 'Ответ на статус: ' || COALESCE(NEW.content, 'Стикер');
      ELSE
        v_body := 'Ответ на ваш статус';
    END CASE;
  ELSE
    CASE NEW.message_type
      WHEN 'text' THEN
        v_body := COALESCE(LEFT(NEW.content, 200), 'Новое сообщение');
      WHEN 'image' THEN
        v_body := 'Фото';
      WHEN 'video' THEN
        v_body := 'Видео';
      WHEN 'voice' THEN
        v_body := 'Голосовое сообщение';
      WHEN 'video_note' THEN
        v_body := 'Видеосообщение';
      WHEN 'document', 'file' THEN
        v_body := 'Файл';
      WHEN 'contact' THEN
        v_body := 'Контакт';
      WHEN 'location' THEN
        v_body := 'Геопозиция';
      WHEN 'sticker' THEN
        v_body := COALESCE(NEW.content, 'Стикер');
      WHEN 'call_started' THEN
        v_body := 'Входящий звонок';
      WHEN 'call_ended' THEN
        v_body := 'Звонок завершён';
      ELSE
        v_body := 'Новое сообщение';
    END CASE;
  END IF;

  -- Filter recipients by their notification settings
  FOR v_recipient IN
    SELECT p.id, p.notification_settings
    FROM profiles p
    WHERE p.id = ANY(v_recipient_ids)
  LOOP
    v_notif_settings := v_recipient.notification_settings;

    -- Skip if messages disabled globally
    IF v_notif_settings IS NOT NULL AND (v_notif_settings->>'messages')::boolean = false THEN
      CONTINUE;
    END IF;

    -- Skip if group notifications disabled and this is a group
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

  -- Build title
  IF v_conv_type = 'group' AND v_conv_name IS NOT NULL THEN
    v_title := v_conv_name;
    v_body := v_sender_name || ': ' || v_body;
  ELSE
    v_title := v_sender_name;
  END IF;

  -- Determine sound
  v_sound := CASE WHEN NEW.message_type = 'call_started' THEN 'ringtone.caf' ELSE 'default' END;

  -- Send push notification
  PERFORM net.http_post(
    url := 'https://wdvgbdgklbrileuyweqs.supabase.co/functions/v1/send-push-notification',
    headers := '{"Content-Type": "application/json"}'::jsonb,
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

  RETURN NEW;
END;
$$;
