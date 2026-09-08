/*
# Create daily_reports table

Stores auto-generated daily activity summaries that appear as special stories
in the stories bar. Each user gets one report per day, auto-expiring after 24 hours.

1. New Tables
   - `daily_reports`
     - `id` (uuid, primary key)
     - `user_id` (uuid, FK to auth.users, defaults to auth.uid())
     - `report_date` (date, the calendar day this report covers)
     - `messages_sent` (int, count of messages sent today)
     - `calls_made` (int, count of calls made today)
     - `stories_posted` (int, count of stories posted today)
     - `contacts_added` (int, count of new contacts added today)
     - `created_at` (timestamptz)
     - `expires_at` (timestamptz, defaults to now() + 24 hours)
     - `dismissed` (boolean, allows user to hide the report)

2. Constraints
   - Unique constraint on (user_id, report_date) to prevent duplicates

3. Security
   - RLS enabled
   - Owner-scoped CRUD: each authenticated user can only access their own reports
*/

CREATE TABLE IF NOT EXISTS daily_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  report_date date NOT NULL DEFAULT CURRENT_DATE,
  messages_sent int NOT NULL DEFAULT 0,
  calls_made int NOT NULL DEFAULT 0,
  stories_posted int NOT NULL DEFAULT 0,
  contacts_added int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  dismissed boolean NOT NULL DEFAULT false,
  UNIQUE(user_id, report_date)
);

CREATE INDEX IF NOT EXISTS idx_daily_reports_user_expires
  ON daily_reports(user_id, expires_at);

ALTER TABLE daily_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_daily_reports" ON daily_reports;
CREATE POLICY "select_own_daily_reports" ON daily_reports FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_daily_reports" ON daily_reports;
CREATE POLICY "insert_own_daily_reports" ON daily_reports FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_daily_reports" ON daily_reports;
CREATE POLICY "update_own_daily_reports" ON daily_reports FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_daily_reports" ON daily_reports;
CREATE POLICY "delete_own_daily_reports" ON daily_reports FOR DELETE
  TO authenticated USING (auth.uid() = user_id);
