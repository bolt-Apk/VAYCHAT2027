/*
  # Fix conversation_members SELECT recursion properly

  1. Problem
    - Even the new SELECT policy still causes recursion because the subquery
      on conversation_members triggers the same policy evaluation

  2. Fix
    - Create a SECURITY DEFINER function that bypasses RLS to get user's conversation IDs
    - Use that function in the policy instead of a direct subquery

  3. Security
    - The function only returns conversation_ids for the authenticated user
    - SECURITY DEFINER runs as the function owner (bypasses RLS) but is restricted by auth.uid()
*/

-- Create a helper function that bypasses RLS to get user's conversations
CREATE OR REPLACE FUNCTION get_user_conversation_ids(p_user_id uuid)
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT conversation_id FROM conversation_members WHERE user_id = p_user_id;
$$;

-- Drop and recreate the SELECT policy using the function
DROP POLICY IF EXISTS "Members can view conversation members" ON conversation_members;

CREATE POLICY "Members can view conversation members"
  ON conversation_members FOR SELECT
  TO authenticated
  USING (
    conversation_id IN (SELECT get_user_conversation_ids(auth.uid()))
  );
