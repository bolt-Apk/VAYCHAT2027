/*
# Fix conversation_members SELECT policy

The existing SELECT policy uses a SECURITY DEFINER function (private.get_user_conversation_ids)
to determine visibility, which can cause issues due to recursive RLS evaluation.

This migration replaces it with a simpler, more direct policy:
- A user can always see their own membership rows (auth.uid() = user_id)
- A user can see other members of conversations they belong to (via a subquery that
  checks their own membership directly, bypassing the function)

This avoids the recursive call chain and ensures conversations always load correctly.
*/

DROP POLICY IF EXISTS "Members can view conversation members" ON conversation_members;

CREATE POLICY "Members can view conversation members"
ON conversation_members FOR SELECT
TO authenticated
USING (
  auth.uid() = user_id
  OR conversation_id IN (
    SELECT cm.conversation_id
    FROM conversation_members cm
    WHERE cm.user_id = auth.uid()
  )
);
