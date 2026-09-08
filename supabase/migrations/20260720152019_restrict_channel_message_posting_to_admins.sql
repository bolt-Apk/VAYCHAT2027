/*
# Restrict channel message posting to owner/admin only

1. Changes
   - Drop and recreate the INSERT policy on `messages` to add a channel restriction.
   - In channels (conversations with type='channel'), only conversation_members with
     role='owner' or role='admin' can insert messages.
   - For non-channel conversations (direct, group, saved), behavior is unchanged:
     any conversation member can post.

2. Security
   - Subscribers (role='member') in channels cannot post messages.
   - This enforces Telegram-style broadcast channels where only admins publish.
*/

-- First check the existing insert policy name
DO $$ BEGIN
  -- Drop existing insert policies on messages
  DROP POLICY IF EXISTS "insert_own_messages" ON messages;
  DROP POLICY IF EXISTS "Members can insert messages" ON messages;
  DROP POLICY IF EXISTS "insert_messages" ON messages;
END $$;

-- Recreate: allow insert if user is a member AND (conversation is not a channel, OR user is owner/admin in that channel)
CREATE POLICY "insert_messages" ON messages FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = sender_id
    AND EXISTS (
      SELECT 1 FROM conversation_members cm
      WHERE cm.conversation_id = messages.conversation_id
        AND cm.user_id = auth.uid()
    )
    AND (
      -- Non-channel conversations: any member can post
      NOT EXISTS (
        SELECT 1 FROM conversations c
        WHERE c.id = messages.conversation_id
          AND c.type = 'channel'
      )
      OR
      -- Channel conversations: only owner/admin can post
      EXISTS (
        SELECT 1 FROM conversation_members cm2
        WHERE cm2.conversation_id = messages.conversation_id
          AND cm2.user_id = auth.uid()
          AND cm2.role IN ('owner', 'admin')
      )
    )
  );
