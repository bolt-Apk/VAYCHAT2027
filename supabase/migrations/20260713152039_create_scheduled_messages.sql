/*
# Create scheduled_messages table

Supports deferred/scheduled message sending. Users can compose a message
and pick a future date+time; the message is stored here until a cron
edge-function moves it into the messages table at the scheduled moment.

1. New Tables
   - `scheduled_messages`
     - `id` (uuid, primary key)
     - `conversation_id` (uuid, FK to conversations)
     - `sender_id` (uuid, FK to auth.users)
     - `content` (text, the message body)
     - `message_type` (text, e.g. text/image/video/voice/file)
     - `media_url` (text, optional media attachment URL)
     - `media_duration` (integer, for voice/video duration)
     - `reply_to_id` (uuid, optional FK to messages)
     - `scheduled_at` (timestamptz, when to deliver)
     - `status` (text: pending / sent / cancelled)
     - `created_at` (timestamptz)

2. Security
   - RLS enabled, owner-scoped CRUD for authenticated users.

3. Indexes
   - On (status, scheduled_at) for the cron query.
   - On (sender_id, conversation_id) for listing user's scheduled messages.
*/

CREATE TABLE IF NOT EXISTS scheduled_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  content text NOT NULL DEFAULT '',
  message_type text NOT NULL DEFAULT 'text',
  media_url text,
  media_duration integer NOT NULL DEFAULT 0,
  reply_to_id uuid REFERENCES messages(id) ON DELETE SET NULL,
  scheduled_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE scheduled_messages ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_scheduled_messages_pending
  ON scheduled_messages (status, scheduled_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_scheduled_messages_sender_conv
  ON scheduled_messages (sender_id, conversation_id);

DROP POLICY IF EXISTS "select_own_scheduled" ON scheduled_messages;
CREATE POLICY "select_own_scheduled" ON scheduled_messages FOR SELECT
  TO authenticated USING (auth.uid() = sender_id);

DROP POLICY IF EXISTS "insert_own_scheduled" ON scheduled_messages;
CREATE POLICY "insert_own_scheduled" ON scheduled_messages FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = sender_id);

DROP POLICY IF EXISTS "update_own_scheduled" ON scheduled_messages;
CREATE POLICY "update_own_scheduled" ON scheduled_messages FOR UPDATE
  TO authenticated USING (auth.uid() = sender_id) WITH CHECK (auth.uid() = sender_id);

DROP POLICY IF EXISTS "delete_own_scheduled" ON scheduled_messages;
CREATE POLICY "delete_own_scheduled" ON scheduled_messages FOR DELETE
  TO authenticated USING (auth.uid() = sender_id);
