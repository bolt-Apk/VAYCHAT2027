/*
# Allow public channel messages to be viewable by all authenticated users

1. Security Changes
  - New SELECT policy on `messages` table for public channels
  - Allows any authenticated user to read messages from public channels
  - This enables non-subscribers to preview channel content before subscribing

2. Important Notes
  - Only applies to channels marked as `is_public = true`
  - Private channels and DMs remain restricted to members only
*/

DROP POLICY IF EXISTS "Public channel messages are readable" ON messages;
CREATE POLICY "Public channel messages are readable"
ON messages FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM conversations c
    WHERE c.id = messages.conversation_id
      AND c.type = 'channel'
      AND c.is_public = true
  )
);
