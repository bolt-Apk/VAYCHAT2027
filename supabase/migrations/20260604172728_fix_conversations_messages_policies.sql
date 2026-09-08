/*
  # Fix conversations and messages policies to use helper function

  1. Problem
    - Conversations SELECT policy uses a subquery on conversation_members
      which triggers conversation_members RLS, potentially causing issues
    - Messages SELECT and INSERT policies have the same pattern

  2. Fix
    - Use the get_user_conversation_ids() SECURITY DEFINER function in these policies too
    - This avoids any indirect recursion through conversation_members RLS
*/

-- Fix conversations SELECT policy
DROP POLICY IF EXISTS "Members can view their conversations" ON conversations;

CREATE POLICY "Members can view their conversations"
  ON conversations FOR SELECT
  TO authenticated
  USING (
    id IN (SELECT get_user_conversation_ids(auth.uid()))
  );

-- Fix conversations UPDATE policy
DROP POLICY IF EXISTS "Admins can update conversations" ON conversations;

CREATE POLICY "Admins can update conversations"
  ON conversations FOR UPDATE
  TO authenticated
  USING (
    id IN (SELECT get_user_conversation_ids(auth.uid()))
  )
  WITH CHECK (
    id IN (SELECT get_user_conversation_ids(auth.uid()))
  );

-- Fix messages SELECT policy
DROP POLICY IF EXISTS "Members can view conversation messages" ON messages;

CREATE POLICY "Members can view conversation messages"
  ON messages FOR SELECT
  TO authenticated
  USING (
    conversation_id IN (SELECT get_user_conversation_ids(auth.uid()))
  );

-- Fix messages INSERT policy
DROP POLICY IF EXISTS "Members can send messages to their conversations" ON messages;

CREATE POLICY "Members can send messages to their conversations"
  ON messages FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = sender_id
    AND conversation_id IN (SELECT get_user_conversation_ids(auth.uid()))
  );
