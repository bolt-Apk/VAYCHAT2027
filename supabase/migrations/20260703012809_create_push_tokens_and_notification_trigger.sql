/*
# Create push_tokens table and notification trigger

## Purpose
Enable push notifications for iOS (and other platforms). When a new message is sent
or a call is initiated, the system will notify recipients who have registered push tokens.

## 1. New Tables
- `push_tokens`
  - `id` (uuid, primary key)
  - `user_id` (uuid, references auth.users, not null, default auth.uid())
  - `token` (text, not null) — the Expo push token (e.g. ExponentPushToken[xxx])
  - `platform` (text, not null) — 'ios', 'android', or 'web'
  - `created_at` (timestamptz)
  - `updated_at` (timestamptz)
  - Unique constraint on (user_id, token) to prevent duplicates

## 2. Security
- RLS enabled on `push_tokens`
- Authenticated users can SELECT, INSERT, UPDATE, DELETE only their own tokens

## 3. Important Notes
- Each user can have multiple tokens (multiple devices)
- Tokens are upserted — if the same token already exists for a user, updated_at is refreshed
*/

-- Create push_tokens table
CREATE TABLE IF NOT EXISTS push_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  token text NOT NULL,
  platform text NOT NULL DEFAULT 'ios',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id, token)
);

-- Index for fast lookups by user_id
CREATE INDEX IF NOT EXISTS idx_push_tokens_user_id ON push_tokens(user_id);

-- Enable RLS
ALTER TABLE push_tokens ENABLE ROW LEVEL SECURITY;

-- RLS policies: owner-scoped
DROP POLICY IF EXISTS "select_own_tokens" ON push_tokens;
CREATE POLICY "select_own_tokens" ON push_tokens FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_tokens" ON push_tokens;
CREATE POLICY "insert_own_tokens" ON push_tokens FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_tokens" ON push_tokens;
CREATE POLICY "update_own_tokens" ON push_tokens FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_tokens" ON push_tokens;
CREATE POLICY "delete_own_tokens" ON push_tokens FOR DELETE
  TO authenticated USING (auth.uid() = user_id);