/*
# Add allowed_reactions column to conversations

1. Modified Tables
   - `conversations`
     - New column `allowed_reactions` (jsonb, nullable) — stores an array of emoji
       strings that subscribers are allowed to react with. NULL means "use default set".

2. Notes
   - Only channel admins will typically set this value.
   - NULL = all default reactions allowed (backward-compatible).
   - An empty array `[]` means reactions are disabled entirely.
*/

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'conversations'
      AND column_name = 'allowed_reactions'
  ) THEN
    ALTER TABLE public.conversations
      ADD COLUMN allowed_reactions jsonb DEFAULT NULL;
  END IF;
END $$;
