/*
# Create call_feedback table for post-call quality ratings

## New Tables
- `call_feedback`
  - `id` (uuid, primary key)
  - `call_id` (uuid, references calls, not null)
  - `user_id` (uuid, references auth.users, not null, defaults to auth.uid())
  - `rating` (integer 1-5, not null) - quality star rating
  - `issues` (text array, nullable) - selected issue tags e.g. ['audio_quality','video_freeze','delay']
  - `comment` (text, nullable) - free-text feedback
  - `created_at` (timestamptz)

## Security
- RLS enabled
- 4 separate policies for authenticated users, owner-scoped

## Indexes
- Unique constraint on (call_id, user_id) to prevent duplicate ratings
- Index on call_id for lookup

## Important Notes
1. Each user can only leave one feedback per call
2. Rating is required (1-5 stars), issues and comment are optional
3. Feedback data can be used for quality analytics
*/

CREATE TABLE IF NOT EXISTS call_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id uuid NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  rating integer NOT NULL CHECK (rating >= 1 AND rating <= 5),
  issues text[] DEFAULT '{}',
  comment text,
  created_at timestamptz DEFAULT now(),
  UNIQUE(call_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_call_feedback_call_id ON call_feedback(call_id);

ALTER TABLE call_feedback ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_call_feedback" ON call_feedback;
CREATE POLICY "select_own_call_feedback" ON call_feedback FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_call_feedback" ON call_feedback;
CREATE POLICY "insert_own_call_feedback" ON call_feedback FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_call_feedback" ON call_feedback;
CREATE POLICY "update_own_call_feedback" ON call_feedback FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_call_feedback" ON call_feedback;
CREATE POLICY "delete_own_call_feedback" ON call_feedback FOR DELETE
  TO authenticated USING (auth.uid() = user_id);
