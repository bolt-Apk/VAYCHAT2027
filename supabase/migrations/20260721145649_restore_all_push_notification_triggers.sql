/*
# Restore all push notification trigger functions

1. Changes
   - Fix ALL notification trigger functions to use the correct Supabase URL 
     (tdzetpypwohhxdcllblp.supabase.co) and remove Authorization headers 
     since send-push-notification is now deployed with verify_jwt=false.
   - **notify_new_message**: Restored media_url, channelId, threadId fields 
     that were lost in a prior migration. Skips call system messages.
   - **notify_incoming_call**: Uses correct URL, includes channelId, sender_avatar.
   - **notify_new_story**: Uses correct URL, includes channelId.
   - **notify_message_reaction**: Complete rewrite with mute/settings checks, 
     message preview, channelId, threadId. Moved to private schema.
   - **notify_contact_joined**: Fixed URL, removed auth header dependency.

2. Security
   - All functions remain SECURITY DEFINER in private schema.
   - No RLS changes.
   - Edge function called without Authorization (verify_jwt=false).

3. Important Notes
   - The send-push-notification edge function is deployed with verify_jwt=false
     so DB triggers can call it directly without needing vault secrets.
   - All 5 triggers now use the same calling pattern for consistency.
   - Dropped the outdated public.notify_message_reaction function.
*/

-- 1. notify_new_message: full-featured with media_url, channelId, threadId
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
  v_media_url text := '';
  v_channel_id text;
BEGIN
  -- Skip call system messages - handled by notify_incoming_call
  IF NEW.message_type IN ('call', 'call_started', 'call_ended') THEN
    RETURN NEW;
  END IF;

  -- Skip channel messages (channels don't send push to subscribers)
  SELECT type, name INTO v_conv_type, v_conv_name
  FROM public.conversations WHERE id = NEW.conversation_id;

  IF v_conv_type = 'channel' THEN
    RETURN NEW;
  END IF;

  SELECT display_name, avatar_url INTO v_sender_name, v_sender_avatar
  FROM public.profiles WHERE id = NEW.sender_id;

  IF v_sender_name IS NULL OR v_sender_name = '' THEN
    v_sender_name := 'Пользователь';
  END IF;

  -- Get media URL for image/video messages
  IF NEW.message_type IN ('image', 'video') AND NEW.media_url IS NOT NULL THEN
    v_media_url := NEW.media_url;
  END IF;

  -- Clear expired mutes
  UPDATE public.conversation_members
  SET is_muted = false, muted_until = NULL
  WHERE conversation_id = NEW.conversation_id
    AND is_muted = true
    AND muted_until IS NOT NULL
    AND muted_until <= now();

  -- Get non-muted recipients
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
      ELSE v_body := 'Новое сообщение';
    END CASE;
  END IF;

  -- Filter by notification settings
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

  v_sound := 'default';
  v_channel_id := CASE
    WHEN v_is_story_reply THEN 'stories'
    ELSE 'messages'
  END;

  PERFORM net.http_post(
    url := 'https://tdzetpypwohhxdcllblp.supabase.co/functions/v1/send-push-notification',
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
          WHEN v_is_story_reply THEN 'story_reply'
          ELSE 'message'
        END,
        'is_story_reply', v_is_story_reply,
        'status_id', COALESCE(NEW.status_id::text, '')
      ),
      'sound', v_sound,
      'categoryId', CASE WHEN v_is_story_reply THEN 'story_reply' ELSE 'message' END,
      'channelId', v_channel_id,
      'threadId', NEW.conversation_id::text
    )
  );

  RETURN NEW;
END;
$$;

-- 2. notify_incoming_call: correct URL, no auth header
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
    url := 'https://tdzetpypwohhxdcllblp.supabase.co/functions/v1/send-push-notification',
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

-- 3. notify_new_story: correct URL, no auth header
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

  -- Filter by notification settings
  SELECT array_agg(p.id) INTO v_user_ids
  FROM public.profiles p
  WHERE p.id = ANY(v_user_ids)
    AND (p.notification_settings IS NULL OR (p.notification_settings->>'stories')::boolean != false);

  IF v_user_ids IS NULL OR array_length(v_user_ids, 1) IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url := 'https://tdzetpypwohhxdcllblp.supabase.co/functions/v1/send-push-notification',
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
$$;

-- 4. notify_message_reaction: complete rewrite with proper checks
CREATE OR REPLACE FUNCTION private.notify_message_reaction()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
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
  FROM public.messages
  WHERE id = NEW.message_id;

  IF v_message_sender_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Don't notify self-reactions
  IF NEW.user_id = v_message_sender_id THEN
    RETURN NEW;
  END IF;

  -- Check if conversation is muted for the message sender
  SELECT is_muted INTO v_is_muted
  FROM public.conversation_members
  WHERE conversation_id = v_conversation_id
    AND user_id = v_message_sender_id;

  IF v_is_muted = true THEN
    RETURN NEW;
  END IF;

  -- Check notification settings
  SELECT notification_settings INTO v_notif_settings
  FROM public.profiles
  WHERE id = v_message_sender_id;

  IF v_notif_settings IS NOT NULL AND (v_notif_settings->>'messages')::boolean = false THEN
    RETURN NEW;
  END IF;

  -- Get reactor name
  SELECT display_name INTO v_reactor_name
  FROM public.profiles
  WHERE id = NEW.user_id;

  IF v_reactor_name IS NULL OR v_reactor_name = '' THEN
    v_reactor_name := 'Пользователь';
  END IF;

  -- Get conversation info
  SELECT type, name INTO v_conv_type, v_conv_name
  FROM public.conversations
  WHERE id = v_conversation_id;

  -- Build message preview
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
    url := 'https://tdzetpypwohhxdcllblp.supabase.co/functions/v1/send-push-notification',
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
      'channelId', 'reactions',
      'threadId', v_conversation_id::text
    )
  );

  RETURN NEW;
END;
$$;

-- 5. notify_contact_joined: correct URL, no auth header
CREATE OR REPLACE FUNCTION private.notify_contact_joined()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_joined_name text;
BEGIN
  SELECT display_name INTO v_joined_name
  FROM public.profiles WHERE id = NEW.joined_user_id;

  IF v_joined_name IS NULL OR v_joined_name = '' THEN
    v_joined_name := 'Пользователь';
  END IF;

  PERFORM net.http_post(
    url := 'https://tdzetpypwohhxdcllblp.supabase.co/functions/v1/send-push-notification',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := jsonb_build_object(
      'user_ids', jsonb_build_array(NEW.user_id),
      'title', 'VayChat',
      'body', v_joined_name || ' присоединился(ась) к VayChat!',
      'data', jsonb_build_object(
        'joined_user_id', NEW.joined_user_id,
        'type', 'contact_joined'
      ),
      'categoryId', 'contact_joined',
      'channelId', 'contacts'
    )
  );

  RETURN NEW;
END;
$$;

-- Update the trigger to point to private schema for reactions
DROP TRIGGER IF EXISTS on_new_reaction_notify ON public.message_reactions;
CREATE TRIGGER on_new_reaction_notify
  AFTER INSERT ON public.message_reactions
  FOR EACH ROW
  EXECUTE FUNCTION private.notify_message_reaction();

-- Drop the old public.notify_message_reaction if it exists
DROP FUNCTION IF EXISTS public.notify_message_reaction();

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION private.notify_new_message() TO postgres;
GRANT EXECUTE ON FUNCTION private.notify_incoming_call() TO postgres;
GRANT EXECUTE ON FUNCTION private.notify_new_story() TO postgres;
GRANT EXECUTE ON FUNCTION private.notify_message_reaction() TO postgres;
GRANT EXECUTE ON FUNCTION private.notify_contact_joined() TO postgres;
