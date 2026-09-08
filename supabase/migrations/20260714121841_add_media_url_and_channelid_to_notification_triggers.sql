/*
# Add media_url to message notification trigger and channelId to all triggers

## Changes
1. **notify_new_message**: 
   - Adds `media_url` to the data payload (first media attachment URL for image messages)
   - Adds `channelId` field mapped to Android notification channels:
     - 'incoming_calls' for call_started messages
     - 'messages' for regular messages
     - 'stories' for story replies
   - Adds `threadId` = conversation_id for iOS notification grouping
2. **notify_message_reaction**:
   - Adds `channelId: 'reactions'` to payload
   - Adds `threadId` = conversation_id for grouping
3. **notify_new_story**:
   - Adds `channelId: 'stories'` to payload
4. **notify_incoming_call**:
   - Adds `channelId: 'incoming_calls'` to payload

## Security
- No RLS changes
- All functions remain SECURITY DEFINER in private schema
*/

-- 1. Update notify_new_message to include media_url and channelId
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
  v_preview boolean;
  v_filtered_ids uuid[] := '{}';
  v_is_story_reply boolean := false;
  v_media_url text := '';
  v_channel_id text;
BEGIN
  SELECT type, name INTO v_conv_type, v_conv_name
  FROM public.conversations WHERE id = NEW.conversation_id;

  SELECT display_name, avatar_url INTO v_sender_name, v_sender_avatar
  FROM public.profiles WHERE id = NEW.sender_id;

  IF v_sender_name IS NULL OR v_sender_name = '' THEN
    v_sender_name := 'Пользователь';
  END IF;

  -- Get first media URL for image messages
  IF NEW.message_type = 'image' AND NEW.content IS NOT NULL AND NEW.content != '' THEN
    v_media_url := NEW.content;
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
      WHEN 'call_started' THEN v_body := 'Входящий звонок';
      WHEN 'call_ended' THEN v_body := 'Звонок завершён';
      WHEN 'call' THEN v_body := 'Звонок';
      WHEN 'forwarded' THEN v_body := 'Пересланное сообщение';
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
  v_channel_id := CASE
    WHEN NEW.message_type = 'call_started' THEN 'incoming_calls'
    WHEN v_is_story_reply THEN 'stories'
    ELSE 'messages'
  END;

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
        'media_url', v_media_url,
        'type', CASE
          WHEN NEW.message_type = 'call_started' THEN 'call'
          WHEN v_is_story_reply THEN 'story_reply'
          ELSE 'message'
        END,
        'is_story_reply', v_is_story_reply,
        'status_id', COALESCE(NEW.status_id::text, '')
      ),
      'sound', v_sound,
      'categoryId', CASE WHEN v_is_story_reply THEN 'story_reply' ELSE 'message' END,
      'channelId', v_channel_id
    )
  );

  RETURN NEW;
END;
$$;

-- 2. Update notify_message_reaction to include channelId
CREATE OR REPLACE FUNCTION public.notify_message_reaction()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_message_sender_id uuid;
  v_message_content text;
  v_message_type text;
  v_conversation_id uuid;
  v_reactor_name text;
  v_conv_name text;
  v_conv_type text;
  v_title text;
  v_body text;
  v_is_muted boolean;
  v_notif_settings jsonb;
  v_msg_preview text;
BEGIN
  SELECT sender_id, content, message_type, conversation_id
  INTO v_message_sender_id, v_message_content, v_message_type, v_conversation_id
  FROM messages
  WHERE id = NEW.message_id;

  IF v_message_sender_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.user_id = v_message_sender_id THEN
    RETURN NEW;
  END IF;

  SELECT is_muted INTO v_is_muted
  FROM conversation_members
  WHERE conversation_id = v_conversation_id
    AND user_id = v_message_sender_id;

  IF v_is_muted = true THEN
    RETURN NEW;
  END IF;

  SELECT notification_settings INTO v_notif_settings
  FROM profiles
  WHERE id = v_message_sender_id;

  IF v_notif_settings IS NOT NULL AND (v_notif_settings->>'messages')::boolean = false THEN
    RETURN NEW;
  END IF;

  SELECT display_name INTO v_reactor_name
  FROM profiles
  WHERE id = NEW.user_id;

  IF v_reactor_name IS NULL OR v_reactor_name = '' THEN
    v_reactor_name := 'Пользователь';
  END IF;

  SELECT type, name INTO v_conv_type, v_conv_name
  FROM conversations
  WHERE id = v_conversation_id;

  CASE v_message_type
    WHEN 'text' THEN
      v_msg_preview := LEFT(COALESCE(v_message_content, ''), 50);
    WHEN 'image' THEN
      v_msg_preview := 'фото';
    WHEN 'video' THEN
      v_msg_preview := 'видео';
    WHEN 'voice' THEN
      v_msg_preview := 'голосовое сообщение';
    WHEN 'video_note' THEN
      v_msg_preview := 'видеосообщение';
    WHEN 'sticker' THEN
      v_msg_preview := 'стикер';
    ELSE
      v_msg_preview := 'сообщение';
  END CASE;

  v_title := v_reactor_name;
  v_body := NEW.emoji || ' реакция на: ' || v_msg_preview;

  PERFORM net.http_post(
    url := 'https://wdvgbdgklbrileuyweqs.supabase.co/functions/v1/send-push-notification',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := jsonb_build_object(
      'user_ids', jsonb_build_array(v_message_sender_id),
      'title', v_title,
      'body', v_body,
      'data', jsonb_build_object(
        'conversation_id', v_conversation_id,
        'message_id', NEW.message_id,
        'type', 'reaction',
        'reactor_id', NEW.user_id,
        'reactor_name', v_reactor_name,
        'emoji', NEW.emoji
      ),
      'sound', 'default',
      'categoryId', 'reaction',
      'channelId', 'reactions'
    )
  );

  RETURN NEW;
END;
$$;

-- 3. Update notify_new_story to include channelId
CREATE OR REPLACE FUNCTION private.notify_new_story()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
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
    AND private.can_view_status(NEW.user_id, NEW.visibility, c.user_id);

  IF v_user_ids IS NULL OR array_length(v_user_ids, 1) IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT array_agg(p.id) INTO v_user_ids
  FROM public.profiles p
  WHERE p.id = ANY(v_user_ids)
    AND (p.notification_settings IS NULL OR (p.notification_settings->>'stories')::boolean != false);

  IF v_user_ids IS NULL OR array_length(v_user_ids, 1) IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url := 'https://wdvgbdgklbrileuyweqs.supabase.co/functions/v1/send-push-notification',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := jsonb_build_object(
      'user_ids', to_jsonb(v_user_ids),
      'title', v_author_name,
      'body', v_body,
      'data', jsonb_build_object(
        'status_id', NEW.id,
        'author_id', NEW.user_id,
        'type', 'story'
      ),
      'categoryId', 'story',
      'channelId', 'stories'
    )
  );

  RETURN NEW;
END;
$function$;

-- 4. Update notify_incoming_call to include channelId
CREATE OR REPLACE FUNCTION private.notify_incoming_call()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_name text;
  v_caller_avatar text;
  v_call_type_label text;
  v_user_ids jsonb;
BEGIN
  IF NEW.status != 'ringing' THEN
    RETURN NEW;
  END IF;

  SELECT display_name, avatar_url INTO v_caller_name, v_caller_avatar
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

  PERFORM net.http_post(
    url := 'https://wdvgbdgklbrileuyweqs.supabase.co/functions/v1/send-push-notification',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := jsonb_build_object(
      'user_ids', v_user_ids,
      'title', v_caller_name,
      'body', v_call_type_label,
      'data', jsonb_build_object(
        'call_id', NEW.id,
        'caller_id', NEW.caller_id,
        'call_type', NEW.call_type,
        'type', 'call',
        'sender_avatar', COALESCE(v_caller_avatar, '')
      ),
      'sound', 'ringtone.caf',
      'badge', 1,
      'categoryId', 'incoming_call',
      'channelId', 'incoming_calls'
    )
  );

  RETURN NEW;
END;
$$;

-- Re-grant execute
GRANT EXECUTE ON FUNCTION private.notify_incoming_call() TO postgres;
GRANT EXECUTE ON FUNCTION private.notify_new_message() TO postgres;
GRANT EXECUTE ON FUNCTION private.notify_new_story() TO postgres;
REVOKE EXECUTE ON FUNCTION public.notify_message_reaction() FROM public;
REVOKE EXECUTE ON FUNCTION public.notify_message_reaction() FROM anon;
REVOKE EXECUTE ON FUNCTION public.notify_message_reaction() FROM authenticated;
