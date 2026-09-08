/*
# Add missing foreign key indexes

## Problem
Several foreign key columns used in JOINs and trigger lookups lack indexes,
causing sequential scans during story notification delivery and visibility checks.

## Changes
1. Add index on `close_friends(friend_id)` - used by `can_view_status()` function
   and `notify_new_story()` trigger to find stories visible to a user
2. Add index on `hidden_statuses(hidden_user_id)` - used by story notification
   trigger to filter out users who hid a status poster

## Important Notes
1. Uses IF NOT EXISTS to be idempotent
2. These are non-destructive additions that improve query performance
*/

CREATE INDEX IF NOT EXISTS idx_close_friends_friend_id ON close_friends(friend_id);
CREATE INDEX IF NOT EXISTS idx_hidden_statuses_hidden_user_id ON hidden_statuses(hidden_user_id);
