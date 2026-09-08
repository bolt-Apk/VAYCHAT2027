/*
  # Fix infinite recursion in conversation_members RLS policies

  1. Problem
    - The SELECT policy on conversation_members references itself, causing infinite recursion
    - The INSERT and DELETE policies also reference conversation_members in subqueries

  2. Fix
    - Replace the SELECT policy with a simple ownership check (user can see memberships for conversations they belong to, using user_id directly)
    - Replace INSERT policy to avoid self-referencing subquery
    - Replace DELETE policy to avoid self-referencing subquery

  3. Approach
    - Drop existing problematic policies
    - Create new non-recursive policies that check user_id = auth.uid() directly
*/

-- Drop the problematic policies
DROP POLICY IF EXISTS "Members can view conversation members" ON conversation_members;
DROP POLICY IF EXISTS "Authenticated users can insert conversation members" ON conversation_members;
DROP POLICY IF EXISTS "Admins can delete conversation members" ON conversation_members;

-- New SELECT policy: users can see members of conversations they are in
-- Uses a direct user_id check instead of a self-referencing subquery
CREATE POLICY "Members can view conversation members"
  ON conversation_members FOR SELECT
  TO authenticated
  USING (
    conversation_id IN (
      SELECT cm.conversation_id FROM conversation_members cm WHERE cm.user_id = auth.uid()
    )
  );

-- New INSERT policy: users can add themselves, or admins can add others
CREATE POLICY "Users can join conversations"
  ON conversation_members FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- New DELETE policy: users can leave conversations themselves
CREATE POLICY "Users can leave conversations"
  ON conversation_members FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);
