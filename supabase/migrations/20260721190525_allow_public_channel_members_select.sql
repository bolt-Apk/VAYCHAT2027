/*
# Allow viewing conversation_members for public channels

1. Security Changes
  - New SELECT policy on `conversation_members` for public channels
  - Allows any authenticated user to read member list of public channels
  - This enables non-subscribers to see admin info when previewing a channel

2. Important Notes
  - Only applies to channels with `is_public = true`
  - Private channels and DMs remain restricted
*/

DROP POLICY IF EXISTS "Public channel members are viewable" ON conversation_members;
CREATE POLICY "Public channel members are viewable"
ON conversation_members FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM conversations c
    WHERE c.id = conversation_members.conversation_id
      AND c.type = 'channel'
      AND c.is_public = true
  )
);
