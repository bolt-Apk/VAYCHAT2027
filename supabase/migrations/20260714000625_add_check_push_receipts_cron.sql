/*
# Add cron job to check Expo push receipts

1. Changes
   - Creates a cron job that runs every 20 minutes
   - Calls the check-push-receipts edge function via pg_net
   - Uses service_role_key from vault for authorization

2. Security
   - Edge function validates Authorization header
   - Only callable with service_role_key

3. Important Notes
   - Expo recommends checking receipts 15+ minutes after sending
   - The 20-minute interval ensures receipts are mature enough
   - Old checked receipts are auto-cleaned by the edge function (7 days)
*/

-- Create the cron function that calls the edge function
CREATE OR REPLACE FUNCTION private.check_push_receipts_cron()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_secret text;
BEGIN
  v_secret := private.get_push_secret();

  PERFORM net.http_post(
    url := 'https://wdvgbdgklbrileuyweqs.supabase.co/functions/v1/check-push-receipts',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_secret
    ),
    body := '{}'::jsonb
  );
END;
$$;

GRANT EXECUTE ON FUNCTION private.check_push_receipts_cron() TO postgres;
REVOKE EXECUTE ON FUNCTION private.check_push_receipts_cron() FROM public, anon, authenticated;

-- Remove existing job if re-running
SELECT cron.unschedule('check-push-receipts')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'check-push-receipts');

-- Schedule every 20 minutes
SELECT cron.schedule(
  'check-push-receipts',
  '*/20 * * * *',
  $$SELECT private.check_push_receipts_cron()$$
);
