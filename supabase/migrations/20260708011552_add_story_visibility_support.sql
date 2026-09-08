/*
# Add story visibility support

## Changes
1. Add `visibility` column to `user_statuses` table
   - Values: 'everyone' (all contacts), 'contacts' (mutual contacts only), 'close_friends' (selected contacts), 'nobody'
   - Default: 'everyone' for backward compatibility
   
2. Create `close_friends` table for the close friends list feature
   - `user_id` - the user who owns the list
   - `friend_id` - the friend added to the close friends list
   - Unique constraint on (user_id, friend_id)
   
3. RLS policies for close_friends table - owner-scoped CRUD

## Important Notes
1. The visibility column is added to each status individually, allowing per-story privacy
2. 'everyone' keeps existing behavior - visible to all authenticated users
3. 'contacts' restricts to mutual contacts (both added each other)
4. 'close_friends' restricts to users in the close_friends list
5. 'nobody' hides the story from everyone
6. Existing statuses default to 'everyone' so nothing breaks
*/

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_statuses' AND column_name = 'visibility'
  ) THEN
    ALTER TABLE user_statuses ADD COLUMN visibility text NOT NULL DEFAULT 'everyone'
      CHECK (visibility IN ('everyone', 'contacts', 'close_friends', 'nobody'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS close_friends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  friend_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, friend_id)
);

CREATE INDEX IF NOT EXISTS idx_close_friends_user_id ON close_friends(user_id);

ALTER TABLE close_friends ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_close_friends" ON close_friends;
CREATE POLICY "select_own_close_friends" ON close_friends FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_close_friends" ON close_friends;
CREATE POLICY "insert_own_close_friends" ON close_friends FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_close_friends" ON close_friends;
CREATE POLICY "update_own_close_friends" ON close_friends FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_close_friends" ON close_friends;
CREATE POLICY "delete_own_close_friends" ON close_friends FOR DELETE
  TO authenticated USING (auth.uid() = user_id);
