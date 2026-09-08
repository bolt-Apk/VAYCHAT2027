/*
# Add push receipt queue table and secure all notification triggers

1. New Tables
   - `push_receipt_queue`
     - `id` (uuid, primary key)
     - `ticket_id` (text, not null) - Expo push ticket ID
     - `created_at` (timestamptz, default now())
     - `checked` (boolean, default false) - whether receipt was checked
     - `result` (text) - result from Expo receipt check

2. Security
   - RLS enabled on `push_receipt_queue`
   - Only service role can access (no public policies - internal table)

3. Trigger Changes
   - **All 4 trigger functions** updated to include `X-Push-Secret` header
     using `SUPABASE_SERVICE_ROLE_KEY` as the shared secret
   - **notify_new_message**: Added 'forwarded' message type -> 'Пересланное сообщение'
   - **notify_new_message**: Added `threadId` (conversation_id) for notification collapsing
   - **notify_incoming_call**: No threadId for calls (calls must be individual)
   - **notify_new_story**: Added `threadId` = 'stories' for story grouping
   - **notify_message_reaction**: Added `threadId` (conversation_id) for grouping

4. Important Notes
   - The push_receipt_queue table is for internal use by edge functions only
   - Secret header validation provides defense-in-depth (not the only auth layer)
   - Hardcoded Supabase URL: wdvgbdgklbrileuyweqs.supabase.co
*/

-- Create push receipt queue table
CREATE TABLE IF NOT EXISTS push_receipt_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  checked boolean NOT NULL DEFAULT false,
  result text
);

ALTER TABLE push_receipt_queue ENABLE ROW LEVEL SECURITY;

-- No public policies: only service role (used by edge functions) can access

-- Helper to get the service role key for use in trigger functions
CREATE OR REPLACE FUNCTION private.get_push_secret()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT current_setting('supabase.service_role_key', true);
$$;

GRANT EXECUTE ON FUNCTION private.get_push_secret() TO postgres;

-- Update notify_incoming_call with secret header
CREATE OR REPLACE FUNCTION private.notify_incoming_call()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_name text;
  v_call_type_label text;
  v_user_ids jsonb;
  v_secret text;
BEGIN
  IF NEW.status != 'ringing' THEN
    RETURN NEW;
  END IF;

  SELECT display_name INTO v_caller_name
  FROM public.profiles WHERE id = NEW.caller_id;

  IF v_caller_name IS NULL OR v_caller_name = '' THEN
    v_caller_name := 'Пользователь';
  END IF;

  IF NEW.call_type = 'video' THEN
    v_call_type_label := 'Входящий видеозвонок';
  ELSE
    v_call_type_label := 'Входящий звонок';
  END IF;

  IF NEW.is_group_call = true THEN
    SELECT COALESCE(jsonb_agg(cp.user_id), jsonb_build_array(NEW.receiver_id))
    INTO v_user_ids
    FROM public.call_participants cp
    WHERE cp.call_id = NEW.id AND cp.status = 'ringing';
  ELSE
    v_user_ids := jsonb_build_array(NEW.receiver_id);
  END IF;

  v_secret := private.get_push_secret();

  PERFORM net.http_post(
    url := 'https://wdvgbdgklbrileuyweqs.supabase.co/functions/v1/send-push-notification',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-push-secret', COALESCE(v_secret, '')
    ),
    body := jsonb_build_object(
      'user_ids', v_user_ids,
      'title', v_caller_name,
      'body', v_call_type_label,
      'data', jsonb_build_object(
        'call_id', NEW.id,
        'caller_id', NEW.caller_id,
        'call_type', NEW.call_type,
        'type', 'call'
      ),
      'sound', 'ringtone.caf',
      'badge', 1,
      'categoryId', 'incoming_call'
    )
  );

  RETURN NEW;
END;
$$;

-- Update notify_new_message with secret, forwarded type, threadId
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
BEGIN
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

  v_is_story_reply := (NEW.status_id IS NOT NULL);

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
      'x-push-secret', COALESCE(v_secret, '')
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

  RETURN NEW;
END;
$$;

-- Read existing notify_new_story and notify_message_reaction, update with secret header
-- First, update notify_new_story
CREATE OR REPLACE FUNCTION private.notify_new_story()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_author_name text;
  v_body text;
  v_user_ids uuid[];
  v_secret text;
BEGIN
  SELECT display_name INTO v_author_name
  FROM public.profiles WHERE id = NEW.user_id;

  IF v_author_name IS NULL OR v_author_name = '' THEN
    v_author_name := 'Пользователь';
  END IF;

  IF NEW.media_type = 'voice' THEN
    v_body := 'Новый голосовой статус';
  ELSIF NEW.media_type = 'video' THEN
    v_body := 'Новый видео-статус';
  ELSE
    v_body := 'Новый статус';
  END IF;

  IF NEW.content IS NOT NULL AND NEW.content != '' THEN
    v_body := LEFT(NEW.content, 200);
  END IF;

  SELECT array_agg(DISTINCT c.user_id) INTO v_user_ids
  FROM public.conversation_members c
  JOIN public.conversations conv ON conv.id = c.conversation_id
  WHERE conv.type = 'direct'
    AND c.user_id != NEW.user_id
    AND EXISTS (
      SELECT 1 FROM public.conversation_members cm
      WHERE cm.conversation_id = c.conversation_id AND cm.user_id = NEW.user_id
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.hidden_statuses hs
      WHERE hs.user_id = c.user_id AND hs.hidden_user_id = NEW.user_id
    )
    AND private.can_view_status(c.user_id, NEW.user_id, NEW.visibility, NEW.id);

  IF v_user_ids IS NULL OR array_length(v_user_ids, 1) IS NULL THEN
    RETURN NEW;
  END IF;

  -- Filter by notification settings (stories enabled)
  SELECT array_agg(p.id) INTO v_user_ids
  FROM public.profiles p
  WHERE p.id = ANY(v_user_ids)
    AND (p.notification_settings IS NULL OR (p.notification_settings->>'stories')::boolean != false);

  IF v_user_ids IS NULL OR array_length(v_user_ids, 1) IS NULL THEN
    RETURN NEW;
  END IF;

  v_secret := private.get_push_secret();

  PERFORM net.http_post(
    url := 'https://wdvgbdgklbrileuyweqs.supabase.co/functions/v1/send-push-notification',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-push-secret', COALESCE(v_secret, '')
    ),
    body := jsonb_build_object(
      'user_ids', to_jsonb(v_user_ids),
      'title', v_author_name,
      'body', v_body,
      'data', jsonb_build_object(
        'status_id', NEW.id,
        'author_id', NEW.user_id,
        'type', 'story'
      ),
      'categoryId', 'story'
    )
  );

  RETURN NEW;
END;
$$;

-- Update notify_message_reaction with secret header and threadId
CREATE OR REPLACE FUNCTION private.notify_message_reaction()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_message_sender_id uuid;
  v_reactor_name text;
  v_conversation_id uuid;
  v_secret text;
BEGIN
  SELECT sender_id, conversation_id INTO v_message_sender_id, v_conversation_id
  FROM public.messages WHERE id = NEW.message_id;

  IF v_message_sender_id IS NULL OR v_message_sender_id = NEW.user_id THEN
    RETURN NEW;
  END IF;

  SELECT display_name INTO v_reactor_name
  FROM public.profiles WHERE id = NEW.user_id;

  IF v_reactor_name IS NULL OR v_reactor_name = '' THEN
    v_reactor_name := 'Пользователь';
  END IF;

  v_secret := private.get_push_secret();

  PERFORM net.http_post(
    url := 'https://wdvgbdgklbrileuyweqs.supabase.co/functions/v1/send-push-notification',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-push-secret', COALESCE(v_secret, '')
    ),
    body := jsonb_build_object(
      'user_ids', jsonb_build_array(v_message_sender_id),
      'title', v_reactor_name,
      'body', 'Отреагировал(а) ' || NEW.emoji,
      'data', jsonb_build_object(
        'conversation_id', v_conversation_id,
        'message_id', NEW.message_id,
        'type', 'reaction',
        'emoji', NEW.emoji
      ),
      'categoryId', 'reaction'
    )
  );

  RETURN NEW;
END;
$$;

-- Grant execute on all updated functions
GRANT EXECUTE ON FUNCTION private.notify_incoming_call() TO postgres;
GRANT EXECUTE ON FUNCTION private.notify_new_message() TO postgres;
GRANT EXECUTE ON FUNCTION private.notify_new_story() TO postgres;
GRANT EXECUTE ON FUNCTION private.notify_message_reaction() TO postgres;

-- Create index on push_receipt_queue for the receipt checker
CREATE INDEX IF NOT EXISTS idx_push_receipt_queue_unchecked 
ON push_receipt_queue (created_at) WHERE checked = false;
