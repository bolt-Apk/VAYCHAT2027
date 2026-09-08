/*
# Grant ANALYZE privileges on application tables

1. Problem
  - PostgreSQL autovacuum/autoanalyze is unable to run ANALYZE on 13 tables,
    resulting in "permission denied to analyze" warnings in the logs.
  - Without up-to-date statistics, the query planner may choose suboptimal plans.

2. Fix
  - Grant ALL privileges on the affected tables to the postgres role (superuser/owner).
  - This ensures autovacuum can collect statistics on these tables.

3. Affected tables
  - close_friends
  - push_receipt_queue
  - call_feedback
  - reports
  - daily_reports
  - call_participants
  - drafts
  - scheduled_messages
  - pinned_saved_messages
  - pending_contacts
  - hidden_statuses
  - starred_messages
  - blocked_users

4. Security
  - No changes to RLS policies or application-facing permissions.
  - Only grants ownership-level access to the postgres role for maintenance.
*/

-- Transfer ownership of affected tables to postgres so autovacuum can analyze them
DO $$
DECLARE
  tbl text;
BEGIN
  FOR tbl IN SELECT unnest(ARRAY[
    'close_friends',
    'push_receipt_queue',
    'call_feedback',
    'reports',
    'daily_reports',
    'call_participants',
    'drafts',
    'scheduled_messages',
    'pinned_saved_messages',
    'pending_contacts',
    'hidden_statuses',
    'starred_messages',
    'blocked_users'
  ])
  LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = tbl) THEN
      EXECUTE format('ALTER TABLE public.%I OWNER TO postgres', tbl);
    END IF;
  END LOOP;
END $$;
