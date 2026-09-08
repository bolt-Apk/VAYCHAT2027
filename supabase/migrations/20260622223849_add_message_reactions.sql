/*
# Add message reactions table

1. New Tables
  - `message_reactions`
    - `id` (uuid, primary key)
    - `message_id` (uuid, FK to messages)
    - `user_id` (uuid, FK to auth.users)
    - `emoji` (text, the reaction emoji)
    - `created_at` (timestamp)
    - Unique constraint on (message_id, user_id, emoji) to prevent duplicate reactions

2. Security
  - Enable RLS on `message_reactions`
  - Authenticated users can read reactions for messages in their conversations
  - Authenticated users can add/remove their own reactions

3. Indexes
  - Index on message_id for fast lookups
*/

CREATE TABLE IF NOT EXISTS message_reactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  emoji text NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(message_id, user_id, emoji)
);

CREATE INDEX IF NOT EXISTS idx_message_reactions_message_id ON message_reactions(message_id);

ALTER TABLE message_reactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_reactions" ON message_reactions;
CREATE POLICY "select_reactions" ON message_reactions FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM messages m
      JOIN conversation_members cm ON cm.conversation_id = m.conversation_id
      WHERE m.id = message_reactions.message_id
      AND cm.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "insert_own_reactions" ON message_reactions;
CREATE POLICY "insert_own_reactions" ON message_reactions FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_reactions" ON message_reactions;
CREATE POLICY "delete_own_reactions" ON message_reactions FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

ALTER TABLE message_reactions REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE message_reactions;
