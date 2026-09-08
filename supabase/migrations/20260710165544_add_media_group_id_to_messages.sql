/*
# Add media_group_id to messages

1. Modified Tables
  - `messages`
    - `media_group_id` (text, nullable) — Groups multiple media messages sent together into a collage.
      Messages with the same media_group_id were sent as a batch and should display as a grid/collage.

2. Indexes
  - Index on media_group_id for efficient grouping queries.

3. Important Notes
  - Column is nullable — only set when user sends multiple photos/videos at once.
  - No RLS changes needed — existing message policies already cover this column.
*/

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'messages' AND column_name = 'media_group_id'
  ) THEN
    ALTER TABLE messages ADD COLUMN media_group_id text;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_messages_media_group_id ON messages(media_group_id) WHERE media_group_id IS NOT NULL;
