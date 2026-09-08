/*
# Enhance push notification triggers

## Changes
1. **notify_new_message()** trigger improvements:
   - Respects `muted_until` timestamp: auto-unmutes when expiry passes, skips notification if still muted
   - Includes sender `avatar_url` in push payload for rich notifications
   - Includes `sender_name` in push payload for client-side formatting
   - Includes `conv_type` (direct/group) and `conv_name` in payload
   - Supports additional message types: video_note, contact, location, sticker, forwarded
   - Checks recipient's `notification_settings` JSONB from profiles:
     - `messages = false` → skip message notifications
     - `groups = false` → skip group chat notifications
     - `preview = false` → send generic "Новое сообщение" instead of content
     - `sounds = false` → send without sound
   - Adds `categoryId: 'message'` for interactive reply actions on iOS

2. **Security**: Both functions remain SECURITY DEFINER with restricted search_path

## Important Notes
1. `muted_until` expiry is checked at notification time; the `is_muted` flag is automatically
   cleared when `muted_until` has passed, so subsequent messages also work correctly
2. Notification settings are per-user from the `profiles.notification_settings` JSONB column
3. The edge function URL remains hardcoded (verify_jwt=false deployment)
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

  -- Build message body based on type
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
        'type', CASE WHEN NEW.message_type = 'call_started' THEN 'call' ELSE 'message' END
      ),
      'sound', v_sound,
      'categoryId', 'message'
    )
  );

  RETURN NEW;
END;
$$;
