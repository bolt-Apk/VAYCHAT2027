/*
# Create reports table for content moderation

1. New Tables
  - `reports`
    - `id` (uuid, primary key)
    - `reporter_id` (uuid, FK to profiles, the user filing the report)
    - `reported_user_id` (uuid, FK to profiles, the user being reported)
    - `conversation_id` (uuid, nullable, FK to conversations)
    - `message_id` (uuid, nullable, FK to messages)
    - `reason` (text, not null, category of report)
    - `details` (text, optional additional details)
    - `created_at` (timestamptz)

2. Security
  - RLS enabled
  - Authenticated users can insert reports (reporter_id must match auth.uid())
  - Authenticated users can read their own reports
  - No update or delete allowed for users

3. Notes
  - Supports reporting both users and specific messages
  - reason field uses CHECK constraint for valid categories
*/

CREATE TABLE IF NOT EXISTS reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id uuid NOT NULL DEFAULT auth.uid() REFERENCES profiles(id) ON DELETE CASCADE,
  reported_user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES conversations(id) ON DELETE SET NULL,
  message_id uuid REFERENCES messages(id) ON DELETE SET NULL,
  reason text NOT NULL CHECK (reason IN ('spam', 'harassment', 'inappropriate_content', 'violence', 'fraud', 'other')),
  details text DEFAULT '',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "insert_own_reports" ON reports;
CREATE POLICY "insert_own_reports" ON reports FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = reporter_id);

DROP POLICY IF EXISTS "select_own_reports" ON reports;
CREATE POLICY "select_own_reports" ON reports FOR SELECT
  TO authenticated USING (auth.uid() = reporter_id);
