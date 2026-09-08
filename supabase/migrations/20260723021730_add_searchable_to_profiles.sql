/*
# Add searchable privacy setting to profiles

1. Modified Tables
   - `profiles`
     - `searchable` (boolean, NOT NULL, default true) — when false, the user is hidden from global search results

2. Important Notes
   - Existing users default to searchable (true) so behavior is unchanged
   - Users can toggle this in their privacy settings
*/

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'searchable'
  ) THEN
    ALTER TABLE profiles ADD COLUMN searchable boolean NOT NULL DEFAULT true;
  END IF;
END $$;
