/*
# Add story reference to messages

1. Modified Tables
  - `messages`
    - `status_id` (uuid, nullable) — references the user_status this message is a reply/reaction to
    - `status_snapshot` (jsonb, nullable) — stores a snapshot of the story content at send time
      (content, background_color, text_color, media_url, media_type, author_name)

2. Notes
  - status_snapshot preserves the story content even after the story expires (24h)
  - No foreign key to user_statuses since stories auto-delete after expiry
  - Index on status_id for efficient lookups
*/

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'messages' AND column_name = 'status_id'
  ) THEN
    ALTER TABLE messages ADD COLUMN status_id uuid;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'messages' AND column_name = 'status_snapshot'
  ) THEN
    ALTER TABLE messages ADD COLUMN status_snapshot jsonb;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_messages_status_id ON messages(status_id) WHERE status_id IS NOT NULL;
