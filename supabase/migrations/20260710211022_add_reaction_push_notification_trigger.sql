/*
# Add push notification trigger for message reactions

## Purpose
Automatically send a push notification to the message author when someone
reacts to their message with an emoji. This lets users know in real time
that their message received a reaction.

## Changes
1. Create trigger function `notify_message_reaction()` that:
   - Looks up the original message to find the author (sender_id)
   - Skips notification if the reactor is the message author (self-reaction)
   - Looks up the reactor's display name from profiles
   - Looks up conversation info for the notification title
   - Respects the recipient's mute settings on the conversation
   - Respects the recipient's notification_settings from profiles
   - Sends a push notification via the existing send-push-notification edge function
2. Create an AFTER INSERT trigger on `message_reactions` table

## Security
- Uses SECURITY DEFINER to access push_tokens and profiles regardless of RLS
- Only fires on INSERT (new reactions only)
- Skips self-reactions (user reacting to own message)

## Important Notes
1. The notification body shows the emoji and a preview of the original message
2. The push payload includes conversation_id for navigation on tap
3. Muted conversations are respected (no notification if muted)
4. User notification settings are respected (messages=false skips)
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

  -- Get conversation info
  SELECT type, name INTO v_conv_type, v_conv_name
  FROM conversations
  WHERE id = v_conversation_id;

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

-- Drop existing trigger if any
DROP TRIGGER IF EXISTS on_new_reaction_notify ON message_reactions;

-- Create the trigger
CREATE TRIGGER on_new_reaction_notify
  AFTER INSERT ON message_reactions
  FOR EACH ROW
  EXECUTE FUNCTION notify_message_reaction();

-- Revoke direct execute from public/anon/authenticated (security definer function)
REVOKE EXECUTE ON FUNCTION public.notify_message_reaction() FROM public;
REVOKE EXECUTE ON FUNCTION public.notify_message_reaction() FROM anon;
REVOKE EXECUTE ON FUNCTION public.notify_message_reaction() FROM authenticated;
