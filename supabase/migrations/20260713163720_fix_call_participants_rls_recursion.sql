/*
# Fix call_participants RLS infinite recursion

The SELECT policy on call_participants was self-referencing:
it did `EXISTS (SELECT 1 FROM call_participants cp WHERE ...)` inside
a policy ON call_participants, triggering the same SELECT policy again
in an infinite loop.

1. Changes
   - Replace SELECT policy to check membership via the `calls` table
     (caller_id / receiver_id) OR direct ownership (user_id), avoiding
     any self-reference.
   - Replace INSERT policy to simplify: caller of the call can add anyone,
     or a user can add themselves.

2. Security
   - Users can see participants of calls they belong to.
   - Users can insert participants for calls they initiated, or insert themselves.
   - UPDATE/DELETE remain owner-scoped (unchanged).
*/

-- Fix SELECT: use calls table instead of self-referencing call_participants
DROP POLICY IF EXISTS "select_call_participants" ON call_participants;
CREATE POLICY "select_call_participants" ON call_participants FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM calls
      WHERE calls.id = call_participants.call_id
      AND (calls.caller_id = auth.uid() OR calls.receiver_id = auth.uid())
    )
  );

-- Fix INSERT: avoid any reference back to call_participants
DROP POLICY IF EXISTS "insert_call_participants" ON call_participants;
CREATE POLICY "insert_call_participants" ON call_participants FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM calls
      WHERE calls.id = call_id
      AND calls.caller_id = auth.uid()
    )
  );
