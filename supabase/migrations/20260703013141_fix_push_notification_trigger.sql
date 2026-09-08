/*
# Fix push notification trigger to use direct edge function URL

## Problem
The previous trigger relied on vault secrets which aren't available.
Since the edge function was deployed with verify_jwt=false, no auth is needed.

## Changes
- Updated `notify_new_message()` to call the edge function directly
  using the project's Supabase URL without requiring auth tokens
- Uses pg_net's net.http_post for async HTTP calls
*/

CREATE OR REPLACE FUNCTION public.notify_new_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_recipient_ids uuid[];
  v_sender_name text;
  v_conv_name text;
  v_conv_type text;
  v_body text;
BEGIN
  -- Get conversation info
  SELECT type, name INTO v_conv_type, v_conv_name
  FROM conversations WHERE id = NEW.conversation_id;

  -- Get all members except sender
  SELECT array_agg(user_id) INTO v_recipient_ids
  FROM conversation_members
  WHERE conversation_id = NEW.conversation_id
    AND user_id != NEW.sender_id;

  IF v_recipient_ids IS NULL OR array_length(v_recipient_ids, 1) IS NULL THEN
    RETURN NEW;
  END IF;

  -- Get sender display name
  SELECT display_name INTO v_sender_name
  FROM profiles WHERE id = NEW.sender_id;

  IF v_sender_name IS NULL THEN
    v_sender_name := 'Someone';
  END IF;

  -- Build notification body based on message type
  CASE NEW.message_type
    WHEN 'text' THEN
      v_body := COALESCE(LEFT(NEW.content, 200), 'New message');
    WHEN 'image' THEN
      v_body := 'Sent a photo';
    WHEN 'video' THEN
      v_body := 'Sent a video';
    WHEN 'voice' THEN
      v_body := 'Sent a voice message';
    WHEN 'document' THEN
      v_body := 'Sent a document';
    WHEN 'call_started' THEN
      v_body := 'Incoming call';
    WHEN 'call_ended' THEN
      v_body := 'Call ended';
    ELSE
      v_body := 'New message';
  END CASE;

  -- For group chats, prefix body with sender name
  IF v_conv_type = 'group' THEN
    v_body := v_sender_name || ': ' || v_body;
  END IF;

  -- Determine title
  IF v_conv_type = 'group' AND v_conv_name IS NOT NULL THEN
    NULL;
  ELSE
    v_conv_name := v_sender_name;
  END IF;

  -- Call edge function via pg_net (async, non-blocking)
  PERFORM net.http_post(
    url := 'https://wdvgbdgklbrileuyweqs.supabase.co/functions/v1/send-push-notification',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := jsonb_build_object(
      'user_ids', to_jsonb(v_recipient_ids),
      'title', v_conv_name,
      'body', v_body,
      'data', jsonb_build_object(
        'conversation_id', NEW.conversation_id,
        'message_id', NEW.id,
        'type', CASE WHEN NEW.message_type = 'call_started' THEN 'call' ELSE 'message' END
      ),
      'sound', CASE WHEN NEW.message_type = 'call_started' THEN 'ringtone.caf' ELSE 'default' END
    )
  );

  RETURN NEW;
END;
$$;