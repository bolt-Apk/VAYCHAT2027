/*
# Skip reaction push notifications for channel posts

## Purpose
Channel admins should NOT receive push notifications when subscribers react to
their channel posts. Channels can have thousands of subscribers, so reaction
notifications would be overwhelming and not useful for the admin.

## Changes
1. Modify `notify_message_reaction()` trigger function to check if the message
   belongs to a channel-type conversation.
2. If the conversation type is 'channel', skip the notification entirely.

## Security
- No policy changes. Function remains SECURITY DEFINER.
- Only adds an early-return check; no new permissions granted.

## Important Notes
1. This only affects channel posts. Reactions in private/group chats still
   send notifications as before.
2. The check uses the conversation type already fetched in the function logic.
*/

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
  -- Get the original message info
  SELECT sender_id, content, message_type, conversation_id
  INTO v_message_sender_id, v_message_content, v_message_type, v_conversation_id
  FROM messages
  WHERE id = NEW.message_id;

  -- Skip if message not found
  IF v_message_sender_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Skip self-reactions (user reacting to their own message)
  IF NEW.user_id = v_message_sender_id THEN
    RETURN NEW;
  END IF;

  -- Get conversation info
  SELECT type, name INTO v_conv_type, v_conv_name
  FROM conversations
  WHERE id = v_conversation_id;

  -- Skip notifications for reactions on channel posts
  IF v_conv_type = 'channel' THEN
    RETURN NEW;
  END IF;

  -- Check if the message author has muted this conversation
  SELECT is_muted INTO v_is_muted
  FROM conversation_members
  WHERE conversation_id = v_conversation_id
    AND user_id = v_message_sender_id;

  IF v_is_muted = true THEN
    RETURN NEW;
  END IF;

  -- Check recipient notification settings
  SELECT notification_settings INTO v_notif_settings
  FROM profiles
  WHERE id = v_message_sender_id;

  IF v_notif_settings IS NOT NULL AND (v_notif_settings->>'messages')::boolean = false THEN
    RETURN NEW;
  END IF;

  -- Get reactor display name
  SELECT display_name INTO v_reactor_name
  FROM profiles
  WHERE id = NEW.user_id;

  IF v_reactor_name IS NULL OR v_reactor_name = '' THEN
    v_reactor_name := 'Пользователь';
  END IF;

  -- Build message preview based on type
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

  -- Build title and body
  v_title := v_reactor_name;
  v_body := NEW.emoji || ' реакция на: ' || v_msg_preview;

  -- Send push notification
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
      'categoryId', 'reaction'
    )
  );

  RETURN NEW;
END;
$$;

-- Revoke direct execute from public/anon/authenticated (security definer function)
REVOKE EXECUTE ON FUNCTION public.notify_message_reaction() FROM public;
REVOKE EXECUTE ON FUNCTION public.notify_message_reaction() FROM anon;
REVOKE EXECUTE ON FUNCTION public.notify_message_reaction() FROM authenticated;
