/*
# Add pin_order column to conversation_members

1. Modified Tables
   - `conversation_members`
     - Added `pin_order` (integer, default 0) — controls the display order of pinned chats

2. Notes
   - Used to allow users to reorder their pinned conversations in the chat list
   - Default 0 means unordered; lower numbers appear first
*/

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'conversation_members'
      AND column_name = 'pin_order'
  ) THEN
    ALTER TABLE conversation_members ADD COLUMN pin_order integer NOT NULL DEFAULT 0;
  END IF;
END $$;
