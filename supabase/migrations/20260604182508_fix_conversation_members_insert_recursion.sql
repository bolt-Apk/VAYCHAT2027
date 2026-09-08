/*
  # Fix infinite recursion in conversation_members INSERT policy

  The INSERT policy currently does a subquery on `conversation_members` itself,
  which triggers the SELECT policy, which calls `get_user_conversation_ids`,
  causing infinite recursion.

  Fix: Replace the EXISTS subquery with a call to `get_user_conversation_ids(auth.uid())`
  which runs as SECURITY DEFINER and bypasses RLS.
*/

DROP POLICY IF EXISTS "Members can add users to their conversations" ON public.conversation_members;

CREATE POLICY "Members can add users to their conversations"
  ON public.conversation_members FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    OR conversation_id IN (SELECT get_user_conversation_ids(auth.uid()))
  );
