/*
# Add hidden_statuses table and allow_story_download privacy setting

1. New Tables
  - `hidden_statuses`
    - `id` (uuid, primary key)
    - `user_id` (uuid, not null) - the user who hides stories
    - `hidden_user_id` (uuid, not null) - the user whose stories are hidden
    - `created_at` (timestamptz)
  - Unique constraint on (user_id, hidden_user_id)

2. Security
  - Enable RLS on `hidden_statuses`
  - Owner-scoped CRUD: users can manage only their own hidden list
*/

CREATE TABLE IF NOT EXISTS hidden_statuses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  hidden_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, hidden_user_id)
);

ALTER TABLE hidden_statuses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_hidden" ON hidden_statuses;
CREATE POLICY "select_own_hidden" ON hidden_statuses FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_hidden" ON hidden_statuses;
CREATE POLICY "insert_own_hidden" ON hidden_statuses FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_hidden" ON hidden_statuses;
CREATE POLICY "update_own_hidden" ON hidden_statuses FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_hidden" ON hidden_statuses;
CREATE POLICY "delete_own_hidden" ON hidden_statuses FOR DELETE
  TO authenticated USING (auth.uid() = user_id);
