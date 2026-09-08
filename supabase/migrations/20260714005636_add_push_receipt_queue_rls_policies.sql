/*
# Add RLS policies to push_receipt_queue

This table is an internal server-side queue for tracking push notification
delivery receipts. It is written to by database triggers (SECURITY DEFINER)
and read by a cron job / edge function. No end-user client should ever
access it directly.

1. Security
   - Deny all client access (SELECT, INSERT, UPDATE, DELETE) for both
     anon and authenticated roles.
   - Server-side triggers and functions use SECURITY DEFINER and bypass
     RLS, so they continue to work normally.
*/

-- SELECT: deny all
DROP POLICY IF EXISTS "deny_select_push_receipt_queue" ON public.push_receipt_queue;
CREATE POLICY "deny_select_push_receipt_queue"
  ON public.push_receipt_queue FOR SELECT
  TO anon, authenticated
  USING (false);

-- INSERT: deny all
DROP POLICY IF EXISTS "deny_insert_push_receipt_queue" ON public.push_receipt_queue;
CREATE POLICY "deny_insert_push_receipt_queue"
  ON public.push_receipt_queue FOR INSERT
  TO anon, authenticated
  WITH CHECK (false);

-- UPDATE: deny all
DROP POLICY IF EXISTS "deny_update_push_receipt_queue" ON public.push_receipt_queue;
CREATE POLICY "deny_update_push_receipt_queue"
  ON public.push_receipt_queue FOR UPDATE
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

-- DELETE: deny all
DROP POLICY IF EXISTS "deny_delete_push_receipt_queue" ON public.push_receipt_queue;
CREATE POLICY "deny_delete_push_receipt_queue"
  ON public.push_receipt_queue FOR DELETE
  TO anon, authenticated
  USING (false);
