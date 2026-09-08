/*
# Fix contact_join_notifications replica identity for Realtime filters

1. Problem
  - The `contact_join_notifications` table uses REPLICA IDENTITY DEFAULT (PK only).
  - The app subscribes to realtime changes with `filter: user_id=eq.{userId}`.
  - Supabase Realtime can only filter by columns in the replica identity.
  - This produces P0001 "invalid column for filter user_id" errors.

2. Fix
  - Set REPLICA IDENTITY FULL on `contact_join_notifications` so all columns
    (including `user_id`) are available for realtime filters.

3. Security
  - No security changes. REPLICA IDENTITY FULL simply includes all columns in
    the WAL output for logical replication; it does not affect access control.
*/

ALTER TABLE public.contact_join_notifications REPLICA IDENTITY FULL;
