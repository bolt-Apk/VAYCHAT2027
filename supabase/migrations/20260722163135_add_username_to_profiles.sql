/*
# Add username column to profiles

1. Modified Tables
   - `profiles`
     - `username` (text, unique, nullable) - unique username for invite links like vaychat.net/username

2. Notes
   - Username is optional; users can set it in their profile
   - UNIQUE constraint ensures no duplicates
   - Index for fast lookups by username
*/

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'username'
  ) THEN
    ALTER TABLE profiles ADD COLUMN username text UNIQUE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_profiles_username ON profiles(username) WHERE username IS NOT NULL;
