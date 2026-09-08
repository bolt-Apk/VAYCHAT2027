/*
# Push notification trigger for incoming calls

## Problem
When the app is closed or in the background, incoming calls are not delivered because
the app relies on Supabase Realtime subscriptions (which are only active when the app
is open). This means calls are silently missed when the user isn't actively using the app.

## Solution
Create a database trigger on the `calls` table that fires when a new call with
status 'ringing' is inserted. The trigger sends a push notification to the receiver
via the existing `send-push-notification` edge function, using the same vault-based
credential lookup as the message notification trigger.

## Changes
1. New function `notify_incoming_call()`:
   - Fires AFTER INSERT on `calls` table
   - Only acts when NEW.status = 'ringing'
   - Looks up caller's display_name from profiles
   - Sends push notification to receiver with:
     - Title: caller's name
     - Body: "Входящий звонок" or "Входящий видеозвонок"
     - Data: call_id, caller_id, call_type, type='call'
     - Sound: ringtone.caf for call-specific sound
     - Priority: high (to wake device)
   - Uses pg_net for async HTTP POST to edge function

2. New trigger `on_new_call_notify` on `calls` table

## Security
- Function uses SECURITY DEFINER to access profiles and push_tokens regardless of RLS
- Uses vault secrets for Supabase URL and service role key (same as message trigger)
*/

CREATE OR REPLACE FUNCTION public.notify_incoming_call()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_caller_name text;
  v_call_type_label text;
  v_supabase_url text;
  v_service_key text;
BEGIN
  -- Only send notification for ringing calls
  IF NEW.status != 'ringing' THEN
    RETURN NEW;
  END IF;

  -- Get caller display name
  SELECT display_name INTO v_caller_name
  FROM profiles WHERE id = NEW.caller_id;

  IF v_caller_name IS NULL OR v_caller_name = '' THEN
    v_caller_name := 'Пользователь';
  END IF;

  -- Determine call type label
  IF NEW.call_type = 'video' THEN
    v_call_type_label := 'Входящий видеозвонок';
  ELSE
    v_call_type_label := 'Входящий звонок';
  END IF;

  -- Get Supabase config from vault
  v_supabase_url := current_setting('app.settings.supabase_url', true);
  IF v_supabase_url IS NULL OR v_supabase_url = '' THEN
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

  IF v_supabase_url IS NOT NULL AND v_service_key IS NOT NULL THEN
    PERFORM net.http_post(
      url := v_supabase_url || '/functions/v1/send-push-notification',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_service_key
      ),
      body := jsonb_build_object(
        'user_ids', jsonb_build_array(NEW.receiver_id),
        'title', v_caller_name,
        'body', v_call_type_label,
        'data', jsonb_build_object(
          'call_id', NEW.id,
          'caller_id', NEW.caller_id,
          'call_type', NEW.call_type,
          'type', 'call'
        ),
        'sound', 'ringtone.caf',
        'badge', 1
      )
    );
  END IF;

  RETURN NEW;
END;
$$;

-- Drop existing trigger if any
DROP TRIGGER IF EXISTS on_new_call_notify ON calls;

-- Create the trigger - fires on INSERT only
CREATE TRIGGER on_new_call_notify
  AFTER INSERT ON calls
  FOR EACH ROW
  EXECUTE FUNCTION notify_incoming_call();
