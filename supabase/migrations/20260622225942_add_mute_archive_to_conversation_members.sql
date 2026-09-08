/*
# Add mute and archive columns to conversation_members

1. Modified Tables
  - `conversation_members`
    - `is_muted` (boolean, default false) - whether the user has muted notifications for this chat
    - `is_archived` (boolean, default false) - whether the user has archived this chat
    - `muted_until` (timestamptz, nullable) - optional expiry for mute (null = muted indefinitely)

2. Important Notes
  - These are per-user settings on each conversation membership
  - No new RLS policies needed as conversation_members already has proper policies
  - Indexes added for filtering archived/muted chats efficiently
*/

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'conversation_members' AND column_name = 'is_muted') THEN
    ALTER TABLE conversation_members ADD COLUMN is_muted boolean NOT NULL DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'conversation_members' AND column_name = 'is_archived') THEN
    ALTER TABLE conversation_members ADD COLUMN is_archived boolean NOT NULL DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'conversation_members' AND column_name = 'muted_until') THEN
    ALTER TABLE conversation_members ADD COLUMN muted_until timestamptz DEFAULT null;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_conversation_members_archived ON conversation_members(user_id, is_archived);
