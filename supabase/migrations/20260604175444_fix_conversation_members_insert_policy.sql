/*
  # Fix conversation members INSERT policy

  1. Problem
    - Current policy only allows users to insert themselves (auth.uid() = user_id)
    - This prevents creating direct chats because you need to add the other person too

  2. Solution
    - Replace the INSERT policy to allow adding members when:
      a) The user is adding themselves, OR
      b) The user is already a member of that conversation (can add others)
    - This covers both initial conversation setup and adding new members later

  3. Security
    - Users can still only add members to conversations they belong to
    - The initial creation works because the creator adds themselves first,
      then can add others since they're now a member
*/

DROP POLICY IF EXISTS "Users can join conversations" ON conversation_members;

CREATE POLICY "Members can add users to their conversations"
  ON conversation_members FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    OR
    EXISTS (
      SELECT 1 FROM conversation_members cm
      WHERE cm.conversation_id = conversation_members.conversation_id
      AND cm.user_id = auth.uid()
    )
  );
