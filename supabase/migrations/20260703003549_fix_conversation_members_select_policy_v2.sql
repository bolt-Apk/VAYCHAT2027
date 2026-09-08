/*
# Fix conversation_members SELECT policy (v2)

Replace the single complex policy with two separate, non-recursive policies:

1. "Users can view own memberships" - lets users see their own rows directly
   using auth.uid() = user_id (no recursion possible)
2. "Users can view co-members" - lets users see other members of their conversations
   using the existing SECURITY DEFINER function (avoids recursion because the function
   bypasses RLS internally)

The key fix is that policy #1 guarantees the user's own rows are always visible
without depending on any function call. This fixes the empty conversations list bug.
*/

DROP POLICY IF EXISTS "Members can view conversation members" ON conversation_members;

-- Policy 1: Users always see their own membership rows
DROP POLICY IF EXISTS "Users can view own memberships" ON conversation_members;
CREATE POLICY "Users can view own memberships"
ON conversation_members FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

-- Policy 2: Users can see other members of conversations they belong to
DROP POLICY IF EXISTS "Users can view co-members" ON conversation_members;
CREATE POLICY "Users can view co-members"
ON conversation_members FOR SELECT
TO authenticated
USING (
  conversation_id IN (
    SELECT private.get_user_conversation_ids(auth.uid())
  )
);
