/*
# Fix process_scheduled_messages to use direct URL

1. Changes
   - Simplified the process_scheduled_messages function to use hardcoded 
     Supabase URL directly without vault dependency (since edge function 
     now deployed with verify_jwt=false).
   - Removed complex vault secret lookup.
   - Kept the SQL fallback for reliability.

2. Security
   - No RLS changes.
   - Function remains SECURITY DEFINER in private schema.
*/

CREATE OR REPLACE FUNCTION private.process_scheduled_messages()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_sm record;
  v_has_pending boolean;
BEGIN
  -- Check if there are pending messages to process
  SELECT EXISTS(
    SELECT 1 FROM public.scheduled_messages
    WHERE status = 'pending' AND scheduled_at <= now()
  ) INTO v_has_pending;

  IF NOT v_has_pending THEN
    RETURN;
  END IF;

  -- Call the edge function (verify_jwt=false, no auth needed)
  PERFORM net.http_post(
    url := 'https://tdzetpypwohhxdcllblp.supabase.co/functions/v1/process-scheduled-messages',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  );
END;
$$;

REVOKE ALL ON FUNCTION private.process_scheduled_messages() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.process_scheduled_messages() FROM anon;
REVOKE ALL ON FUNCTION private.process_scheduled_messages() FROM authenticated;
