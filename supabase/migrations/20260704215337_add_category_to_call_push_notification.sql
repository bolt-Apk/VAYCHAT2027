/*
# Add categoryId to call push notification trigger

## Problem
Call push notifications arrive as plain notifications without actionable buttons.
Users cannot accept or decline calls directly from the notification when the app
is closed or in the background.

## Changes
1. Updated `notify_incoming_call()` function:
   - Added `categoryId: 'incoming_call'` to the push notification payload
   - This maps to the notification category registered on the device with
     Accept and Decline action buttons
   - The category enables iOS/Android to show interactive notification actions

## Important Notes
1. The `incoming_call` category is registered on the device via expo-notifications
   with two actions: "accept" (opens app) and "decline" (background dismissal)
2. No schema changes — only the trigger function body is updated
3. Function is idempotent via CREATE OR REPLACE
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
  IF NEW.status != 'ringing' THEN
    RETURN NEW;
  END IF;

  SELECT display_name INTO v_caller_name
  FROM profiles WHERE id = NEW.caller_id;

  IF v_caller_name IS NULL OR v_caller_name = '' THEN
    v_caller_name := 'Пользователь';
  END IF;

  IF NEW.call_type = 'video' THEN
    v_call_type_label := 'Входящий видеозвонок';
  ELSE
    v_call_type_label := 'Входящий звонок';
  END IF;

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
        'badge', 1,
        'categoryId', 'incoming_call'
      )
    );
  END IF;

  RETURN NEW;
END;
$$;