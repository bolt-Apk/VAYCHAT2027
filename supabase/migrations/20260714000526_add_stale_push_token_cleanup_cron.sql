/*
# Add cron job to clean up stale push tokens

1. Changes
   - Creates a cron job that runs daily at 03:00 UTC
   - Deletes push tokens that haven't been updated in 60+ days
   - These tokens are likely from uninstalled apps or logged-out devices

2. Security
   - Cron job runs as database owner (postgres)
   - No RLS changes needed

3. Important Notes
   - Uses pg_cron extension (already enabled by Supabase)
   - Tokens are cleaned based on `updated_at` column
   - Fallback to `created_at` for tokens without updates
*/

-- Enable pg_cron if not already enabled
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;

-- Grant usage on cron schema
GRANT USAGE ON SCHEMA cron TO postgres;

-- Remove existing job if re-running
SELECT cron.unschedule('cleanup-stale-push-tokens')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cleanup-stale-push-tokens');

-- Schedule daily cleanup at 03:00 UTC
SELECT cron.schedule(
  'cleanup-stale-push-tokens',
  '0 3 * * *',
  $$DELETE FROM public.push_tokens WHERE COALESCE(updated_at, created_at) < now() - interval '60 days'$$
);
