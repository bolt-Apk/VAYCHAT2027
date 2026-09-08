-- Add edited_at and is_pinned columns to messages
ALTER TABLE messages ADD COLUMN IF NOT EXISTS edited_at timestamptz;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS is_pinned boolean DEFAULT false;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS forwarded_from_id uuid REFERENCES messages(id) ON DELETE SET NULL;

-- Typing indicators using Supabase presence (no table needed)
-- We'll use Supabase Realtime Presence for typing indicators

-- Index for pinned messages lookup
CREATE INDEX IF NOT EXISTS idx_messages_pinned ON messages(conversation_id) WHERE is_pinned = true;

-- Index for search
CREATE INDEX IF NOT EXISTS idx_messages_content_search ON messages USING gin(to_tsvector('russian', content));
