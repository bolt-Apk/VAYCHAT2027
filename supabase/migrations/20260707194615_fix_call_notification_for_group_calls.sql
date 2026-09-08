/*
# Fix call push notification trigger for group calls

## Problem
The `notify_incoming_call()` trigger only sends push notifications to `receiver_id`,
which works for 1:1 calls but misses other participants in group calls.

## Changes
1. Updated `notify_incoming_call()` function:
   - For group calls (`is_group_call = true`): queries `call_participants` table
     for all participants with status 'ringing' and sends notification to all of them
   - For 1:1 calls: keeps the existing behavior (notifies `receiver_id` only)
   - Maintains all existing fields: categoryId, sound, badge, data payload

## Important Notes
1. The function remains SECURITY DEFINER to access profiles and call_participants
2. Group call participants are identified by `status = 'ringing'` in call_participants
3. The caller (with status 'active') is excluded from notifications
4. Function is idempotent via CREATE OR REPLACE
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
  v_user_ids jsonb;
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

  -- Build user_ids array: for group calls notify all ringing participants, for 1:1 just receiver
  IF NEW.is_group_call = true THEN
    SELECT COALESCE(jsonb_agg(cp.user_id), jsonb_build_array(NEW.receiver_id))
    INTO v_user_ids
    FROM call_participants cp
    WHERE cp.call_id = NEW.id AND cp.status = 'ringing';
  ELSE
    v_user_ids := jsonb_build_array(NEW.receiver_id);
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
  END IF;

  RETURN NEW;
END;
$$;
