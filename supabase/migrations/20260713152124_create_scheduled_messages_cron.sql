/*
# Create cron job for processing scheduled messages

Calls the process-scheduled-messages edge function every minute
to deliver any messages whose scheduled_at time has passed.

1. Extensions
   - Enables pg_cron if not already enabled.

2. Cron Jobs
   - `process-scheduled-messages`: runs every minute, calls the edge function
     via pg_net HTTP POST.
*/

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;

SELECT cron.schedule(
  'process-scheduled-messages',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/process-scheduled-messages',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);
