/*
# Create push notification trigger for new messages

## Purpose
Automatically send push notifications to conversation members when a new message
is inserted. The trigger calls the `send-push-notification` edge function which
forwards notifications through Expo's Push API to iOS (and other) devices.

## Changes
1. Create a trigger function `notify_new_message()` that:
   - Finds all members of the conversation except the sender
   - Looks up the sender's display name
   - Determines the conversation name (group name or sender name for DMs)
   - Calls the send-push-notification edge function via pg_net HTTP extension
2. Create an AFTER INSERT trigger on `messages` table

## Security
- Uses SECURITY DEFINER to access push_tokens and profiles regardless of RLS
- Only fires on INSERT (not update/delete)
- Excludes the message sender from notification recipients
*/

-- Create the trigger function
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
  v_supabase_url text;
  v_service_key text;
BEGIN
  -- Get conversation info
  SELECT type, name INTO v_conv_type, v_conv_name
  FROM conversations WHERE id = NEW.conversation_id;

  -- Get all members except sender
  SELECT array_agg(user_id) INTO v_recipient_ids
  FROM conversation_members
  WHERE conversation_id = NEW.conversation_id
    AND user_id != NEW.sender_id;

  -- No recipients, skip
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
    -- Use group name
    NULL; -- v_conv_name already set
  ELSE
    -- For DMs, title is the sender name
    v_conv_name := v_sender_name;
  END IF;

  -- Get Supabase config
  v_supabase_url := current_setting('app.settings.supabase_url', true);
  IF v_supabase_url IS NULL OR v_supabase_url = '' THEN
    -- Fallback: read from vault or use direct URL
    SELECT decrypted_secret INTO v_supabase_url
    FROM vault.decrypted_secrets
    WHERE name = 'supabase_url'
    LIMIT 1;
  END IF;

  v_service_key := current_setting('app.settings.service_role_key', true);
  IF v_service_key IS NULL OR v_service_key = '' THEN
    SELECT decrypted_secret INTO v_service_key
    FROM vault.decrypted_secrets
    WHERE name = 'service_role_key'
    LIMIT 1;
  END IF;

  -- If we can't get the URL/key, try using net extension with hardcoded project ref
  -- The edge function URL follows the pattern: {supabase_url}/functions/v1/{function-name}
  IF v_supabase_url IS NOT NULL AND v_service_key IS NOT NULL THEN
    PERFORM net.http_post(
      url := v_supabase_url || '/functions/v1/send-push-notification',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_service_key
      ),
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
  END IF;

  RETURN NEW;
END;
$$;

-- Drop existing trigger if any
DROP TRIGGER IF EXISTS on_new_message_notify ON messages;

-- Create the trigger
CREATE TRIGGER on_new_message_notify
  AFTER INSERT ON messages
  FOR EACH ROW
  EXECUTE FUNCTION notify_new_message();