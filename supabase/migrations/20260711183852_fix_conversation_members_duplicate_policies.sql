/*
# Fix conversation_members duplicate policies causing infinite recursion

## Problem
The `conv_members_select` policy contains a self-referencing subquery
(`EXISTS (SELECT 1 FROM conversation_members cm2 ...)`) which causes
PostgreSQL error 42P17 "infinite recursion detected in policy".

There are also duplicate INSERT/DELETE/UPDATE policies from the initial
migration that conflict with the corrected versions.

## Changes
- Drop `conv_members_select` (self-referencing, causes recursion)
- Drop `conv_members_insert` (permissive `true`, replaced by scoped policy)
- Drop `conv_members_update` (duplicate of "Users can update own membership")
- Drop `conv_members_delete` (duplicate of "Users can leave conversations")

## Policies kept
- "Users can view own memberships" (SELECT, auth.uid() = user_id)
- "Users can view co-members" (SELECT, via private.get_user_conversation_ids)
- "Members can add users to their conversations" (INSERT, scoped)
- "Users can update own membership" (UPDATE)
- "Users can leave conversations" (DELETE)
*/

DROP POLICY IF EXISTS "conv_members_select" ON conversation_members;
DROP POLICY IF EXISTS "conv_members_insert" ON conversation_members;
DROP POLICY IF EXISTS "conv_members_update" ON conversation_members;
DROP POLICY IF EXISTS "conv_members_delete" ON conversation_members;
