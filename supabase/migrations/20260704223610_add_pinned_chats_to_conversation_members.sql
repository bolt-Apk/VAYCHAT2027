/*
# Add pinned chats support to conversation_members

1. Modified Tables
   - `conversation_members`: Added `is_pinned` column
     - `is_pinned` (boolean, default false) - whether the user has pinned this conversation to the top of their chat list

2. Indexes
   - `idx_conversation_members_pinned` on (user_id, is_pinned) for fast filtering of pinned conversations

3. Important Notes
   - This is a non-destructive change, only adds a new column with a default value
   - Each user can independently pin conversations - pinning is per-user, not global
   - Pinned conversations appear at the top of the chat list, sorted by most recent activity
*/

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'conversation_members' AND column_name = 'is_pinned'
  ) THEN
    ALTER TABLE conversation_members ADD COLUMN is_pinned boolean NOT NULL DEFAULT false;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_conversation_members_pinned
  ON conversation_members (user_id, is_pinned);
