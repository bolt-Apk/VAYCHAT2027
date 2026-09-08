/*
# Add is_verified column to conversations

1. Modified Tables
   - `conversations`
     - `is_verified` (boolean, default false) - indicates whether a channel is officially verified

2. Data Changes
   - Sets is_verified = true for the @vaychat channel (admin channel)

3. Important Notes
   - This column will be used to display a verification badge on verified channels
*/

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'conversations'
      AND column_name = 'is_verified'
  ) THEN
    ALTER TABLE conversations ADD COLUMN is_verified boolean NOT NULL DEFAULT false;
  END IF;
END $$;

UPDATE conversations SET is_verified = true WHERE username = 'vaychat';
