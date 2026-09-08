/*
# Add story reactions table

1. New Tables
  - `status_reactions`
    - `id` (uuid, primary key)
    - `status_id` (uuid, references user_statuses)
    - `user_id` (uuid, references auth.users, defaults to auth.uid())
    - `emoji` (text, the reaction emoji)
    - `created_at` (timestamptz)
  - Unique constraint on (status_id, user_id) so one reaction per user per story

2. Security
  - Enable RLS on `status_reactions`
  - Authenticated users can read reactions on statuses they can see
  - Users can insert/update/delete their own reactions

3. Notes
  - Users can react to any visible story with an emoji
  - One reaction per user per story (upsert pattern)
*/

CREATE TABLE IF NOT EXISTS status_reactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status_id uuid NOT NULL REFERENCES user_statuses(id) ON DELETE CASCADE,
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  emoji text NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(status_id, user_id)
);

ALTER TABLE status_reactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_status_reactions" ON status_reactions;
CREATE POLICY "select_status_reactions" ON status_reactions FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "insert_own_status_reactions" ON status_reactions;
CREATE POLICY "insert_own_status_reactions" ON status_reactions FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_status_reactions" ON status_reactions;
CREATE POLICY "update_own_status_reactions" ON status_reactions FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_status_reactions" ON status_reactions;
CREATE POLICY "delete_own_status_reactions" ON status_reactions FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_status_reactions_status_id ON status_reactions(status_id);
CREATE INDEX IF NOT EXISTS idx_status_reactions_user_id ON status_reactions(user_id);
