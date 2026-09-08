/*
# Add quiet hours support and notification delivery tracking

1. Modified Tables
   - `profiles`
     - `quiet_hours_enabled` (boolean, default false) - whether quiet hours are active
     - `quiet_hours_start` (time, default '23:00') - start of quiet period (local time)
     - `quiet_hours_end` (time, default '07:00') - end of quiet period (local time)
     - `quiet_hours_timezone` (text, default 'Europe/Moscow') - user's timezone

2. New Tables
   - `private.notification_delivery_log`
     - `id` (bigint, generated) - auto-increment primary key
     - `user_id` (uuid) - recipient user
     - `notification_type` (text) - message, call, story, reaction, contact_joined
     - `conversation_id` (uuid, nullable) - associated conversation
     - `delivered_at` (timestamptz) - when notification was sent
     - `suppressed` (boolean) - whether it was suppressed by quiet hours or settings

3. Changes
   - Updated `private.notify_new_message()` to check quiet hours before sending
   - During quiet hours, notifications are logged as suppressed but NOT sent
   - Calls (call_started) bypass quiet hours (always delivered)
   - Added cleanup: logs older than 30 days are removed on each insert

4. Security
   - Delivery log is in private schema, not exposed via REST API
   - No RLS needed (private schema)

5. Important Notes
   - Quiet hours support overnight ranges (e.g. 23:00 - 07:00)
   - Timezone-aware: converts current time to user's local time
   - Calls always ring through even during quiet hours
*/

-- Add quiet hours columns to profiles
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'quiet_hours_enabled') THEN
    ALTER TABLE public.profiles ADD COLUMN quiet_hours_enabled boolean NOT NULL DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'quiet_hours_start') THEN
    ALTER TABLE public.profiles ADD COLUMN quiet_hours_start time NOT NULL DEFAULT '23:00';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'quiet_hours_end') THEN
    ALTER TABLE public.profiles ADD COLUMN quiet_hours_end time NOT NULL DEFAULT '07:00';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'quiet_hours_timezone') THEN
    ALTER TABLE public.profiles ADD COLUMN quiet_hours_timezone text NOT NULL DEFAULT 'Europe/Moscow';
  END IF;
END $$;

-- Create delivery log table
CREATE TABLE IF NOT EXISTS private.notification_delivery_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL,
  notification_type text NOT NULL,
  conversation_id uuid,
  delivered_at timestamptz NOT NULL DEFAULT now(),
  suppressed boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_delivery_log_user_date
  ON private.notification_delivery_log (user_id, delivered_at DESC);

-- Helper function to check if a user is in quiet hours
CREATE OR REPLACE FUNCTION private.is_in_quiet_hours(p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_enabled boolean;
  v_start time;
  v_end time;
  v_tz text;
  v_now time;
BEGIN
  SELECT quiet_hours_enabled, quiet_hours_start, quiet_hours_end, quiet_hours_timezone
  INTO v_enabled, v_start, v_end, v_tz
  FROM public.profiles
  WHERE id = p_user_id;

  IF NOT v_enabled OR v_enabled IS NULL THEN
    RETURN false;
  END IF;

  v_now := (now() AT TIME ZONE COALESCE(v_tz, 'Europe/Moscow'))::time;

  IF v_start > v_end THEN
    RETURN v_now >= v_start OR v_now < v_end;
  ELSE
    RETURN v_now >= v_start AND v_now < v_end;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION private.is_in_quiet_hours(uuid) TO postgres;
REVOKE EXECUTE ON FUNCTION private.is_in_quiet_hours(uuid) FROM public, anon, authenticated;

-- Updated notify_new_message with quiet hours + delivery logging
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
  v_quiet_filtered uuid[] := '{}';
  v_is_story_reply boolean := false;
  v_secret text;
  v_last_sent timestamptz;
  v_is_call boolean;
  v_uid uuid;
BEGIN
  v_is_story_reply := (NEW.status_id IS NOT NULL);
  v_is_call := NEW.message_type IN ('call_started', 'call_ended', 'call');

  -- Rate limit: skip if same conversation notified < 3 seconds ago (except calls/story replies)
  IF NOT v_is_story_reply AND NOT v_is_call THEN
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

  -- Auto-unmute expired mutes
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

  -- Build notification body
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

  -- Filter by user notification preferences
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

  -- Filter by quiet hours (calls bypass quiet hours)
  IF v_is_call THEN
    v_quiet_filtered := v_filtered_ids;
  ELSE
    FOREACH v_uid IN ARRAY v_filtered_ids
    LOOP
      IF private.is_in_quiet_hours(v_uid) THEN
        INSERT INTO private.notification_delivery_log (user_id, notification_type, conversation_id, suppressed)
        VALUES (v_uid, CASE WHEN v_is_story_reply THEN 'story_reply' ELSE 'message' END, NEW.conversation_id, true);
      ELSE
        v_quiet_filtered := v_quiet_filtered || v_uid;
      END IF;
    END LOOP;
  END IF;

  IF array_length(v_quiet_filtered, 1) IS NULL THEN
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
      'user_ids', to_jsonb(v_quiet_filtered),
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

  -- Log successful deliveries
  FOREACH v_uid IN ARRAY v_quiet_filtered
  LOOP
    INSERT INTO private.notification_delivery_log (user_id, notification_type, conversation_id, suppressed)
    VALUES (v_uid, CASE WHEN v_is_story_reply THEN 'story_reply' WHEN v_is_call THEN 'call' ELSE 'message' END, NEW.conversation_id, false);
  END LOOP;

  -- Update rate limit
  INSERT INTO private.notification_rate_limit (conversation_id, last_sent_at)
  VALUES (NEW.conversation_id, now())
  ON CONFLICT (conversation_id) DO UPDATE SET last_sent_at = now();

  -- Cleanup old records
  DELETE FROM private.notification_rate_limit WHERE last_sent_at < now() - interval '1 hour';
  DELETE FROM private.notification_delivery_log WHERE delivered_at < now() - interval '30 days';

  RETURN NEW;
END;
$$;

GRANT EXECUTE ON FUNCTION private.notify_new_message() TO postgres;
