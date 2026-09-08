/*
# Grant MAINTAIN privilege to supabase_admin for ANALYZE access

1. Problem
  - PostgreSQL autovacuum/maintenance tasks running as supabase_admin cannot
    ANALYZE 13 public tables, causing "permission denied to analyze" warnings.
  - Tables are already owned by postgres, but the ANALYZE operation is being
    executed by supabase_admin which lacks MAINTAIN privilege (PG17 feature).

2. Fix
  - Grant MAINTAIN privilege on all affected tables to supabase_admin.
  - MAINTAIN allows ANALYZE, VACUUM, REINDEX, CLUSTER without full ownership.

3. Affected tables
  - scheduled_messages, push_receipt_queue, daily_reports, reports, drafts,
    pinned_saved_messages, call_feedback, pending_contacts, hidden_statuses,
    call_participants, close_friends, starred_messages, blocked_users

4. Security
  - No changes to RLS policies or application-facing permissions.
  - MAINTAIN is a maintenance-only privilege, no data read/write access granted.
*/

GRANT MAINTAIN ON TABLE public.scheduled_messages TO supabase_admin;
GRANT MAINTAIN ON TABLE public.push_receipt_queue TO supabase_admin;
GRANT MAINTAIN ON TABLE public.daily_reports TO supabase_admin;
GRANT MAINTAIN ON TABLE public.reports TO supabase_admin;
GRANT MAINTAIN ON TABLE public.drafts TO supabase_admin;
GRANT MAINTAIN ON TABLE public.pinned_saved_messages TO supabase_admin;
GRANT MAINTAIN ON TABLE public.call_feedback TO supabase_admin;
GRANT MAINTAIN ON TABLE public.pending_contacts TO supabase_admin;
GRANT MAINTAIN ON TABLE public.hidden_statuses TO supabase_admin;
GRANT MAINTAIN ON TABLE public.call_participants TO supabase_admin;
GRANT MAINTAIN ON TABLE public.close_friends TO supabase_admin;
GRANT MAINTAIN ON TABLE public.starred_messages TO supabase_admin;
GRANT MAINTAIN ON TABLE public.blocked_users TO supabase_admin;
