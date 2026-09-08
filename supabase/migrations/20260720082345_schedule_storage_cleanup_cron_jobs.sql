/*
# Schedule storage cleanup cron jobs

- cleanup_expired_statuses: hourly at :05 — deletes expired user_statuses
  rows and their stories-media files.
- cleanup_orphaned_media: daily at 03:30 UTC — sweeps both chat-media and
  stories-media buckets for unreferenced files.

Both run via pg_cron as the postgres superuser, bypassing RLS.
*/

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;

DO $$
DECLARE
  jid integer;
BEGIN
  FOR jid IN
    SELECT jobid FROM cron.job
    WHERE command LIKE '%cleanup_expired_statuses%'
       OR command LIKE '%cleanup_orphaned_media%'
  LOOP
    PERFORM cron.unschedule(jid);
  END LOOP;
END $$;

SELECT cron.schedule(
  'cleanup_expired_statuses_hourly',
  '5 * * * *',
  $$SELECT private.cleanup_expired_statuses();$$
);

SELECT cron.schedule(
  'cleanup_orphaned_media_daily',
  '30 3 * * *',
  $$SELECT private.cleanup_orphaned_media(500);$$
);
