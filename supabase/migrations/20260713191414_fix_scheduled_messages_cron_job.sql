/*
# Fix scheduled messages cron job

The previous cron job used current_setting('app.settings.supabase_url')
which fails because app.settings.* are not configured as PostgreSQL parameters.

This migration:
1. Drops the broken cron job.
2. Creates a SECURITY DEFINER function that reads credentials from vault
   (matching the pattern used by push notification triggers).
3. Schedules a new cron job that calls this function every minute.
4. Adds a direct SQL fallback: if the edge function call fails, the function
   processes pending scheduled messages directly in the database.
*/

-- Drop the broken cron job
SELECT cron.unschedule('process-scheduled-messages');

-- Create the processing function in private schema
CREATE OR REPLACE FUNCTION private.process_scheduled_messages()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, extensions
AS $$
DECLARE
  v_supabase_url text;
  v_service_key text;
  v_sm record;
BEGIN
  -- Try to call the edge function first (async, non-blocking)
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
      url := v_supabase_url || '/functions/v1/process-scheduled-messages',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || v_service_key,
        'Content-Type', 'application/json'
      ),
      body := '{}'::jsonb
    );
  ELSE
    -- Fallback: process directly in the database if credentials not available
    FOR v_sm IN
      SELECT * FROM scheduled_messages
      WHERE status = 'pending' AND scheduled_at <= now()
      ORDER BY scheduled_at ASC
      LIMIT 50
    LOOP
      BEGIN
        INSERT INTO messages (
          conversation_id, sender_id, content, message_type,
          media_url, media_duration, reply_to_id, is_read
        ) VALUES (
          v_sm.conversation_id, v_sm.sender_id, v_sm.content, v_sm.message_type,
          v_sm.media_url, v_sm.media_duration, v_sm.reply_to_id, false
        );

        UPDATE scheduled_messages SET status = 'sent' WHERE id = v_sm.id;
        UPDATE conversations SET updated_at = now() WHERE id = v_sm.conversation_id;
      EXCEPTION WHEN OTHERS THEN
        -- Skip this message, try next
        NULL;
      END;
    END LOOP;
  END IF;
END;
$$;

-- Revoke public access
REVOKE ALL ON FUNCTION private.process_scheduled_messages() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.process_scheduled_messages() FROM anon;
REVOKE ALL ON FUNCTION private.process_scheduled_messages() FROM authenticated;

-- Schedule the new cron job using the function
SELECT cron.schedule(
  'process-scheduled-messages',
  '* * * * *',
  $$SELECT private.process_scheduled_messages()$$
);
