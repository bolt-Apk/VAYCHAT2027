/*
# Add server-side drafts table, security settings, and fix conversation type constraint

1. Schema Changes
   - Update conversations type constraint to allow 'saved' type
   - Add `security_settings` JSONB column to `profiles` for PIN/lock settings sync
   
2. New Tables
   - `drafts` - Server-side message drafts per conversation per user
     - `id` (uuid, primary key)
     - `user_id` (uuid, NOT NULL, default auth.uid(), FK to auth.users)
     - `conversation_id` (uuid, NOT NULL, FK to conversations)
     - `text` (text, default '')
     - `reply_to_id` (uuid, nullable, FK to messages)
     - `editing_message_id` (uuid, nullable, FK to messages)
     - `voice_uri` (text, nullable)
     - `voice_duration` (integer, default 0)
     - `voice_mime_type` (text, nullable)
     - `updated_at` (timestamptz, default now())
     - UNIQUE(user_id, conversation_id) - one draft per conversation per user

3. Security
   - RLS enabled on `drafts`
   - Owner-scoped CRUD policies (auth.uid() = user_id)
   - Only authenticated users can access their own drafts

4. Important Notes
   - The conversations type constraint is updated to include 'saved' for Saved Messages feature
   - security_settings stores PIN hash, lock timeout, biometric prefs as JSONB on profiles
   - Drafts use UPSERT pattern (one draft per user per conversation)
*/

-- 1. Fix conversations type constraint to include 'saved'
ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_type_check;
ALTER TABLE conversations ADD CONSTRAINT conversations_type_check 
  CHECK (type = ANY (ARRAY['direct'::text, 'group'::text, 'saved'::text]));

-- 2. Add security_settings JSONB to profiles
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'security_settings'
  ) THEN
    ALTER TABLE profiles ADD COLUMN security_settings jsonb;
  END IF;
END $$;

-- 3. Create drafts table
CREATE TABLE IF NOT EXISTS drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  text text NOT NULL DEFAULT '',
  reply_to_id uuid REFERENCES messages(id) ON DELETE SET NULL,
  editing_message_id uuid REFERENCES messages(id) ON DELETE SET NULL,
  voice_uri text,
  voice_duration integer NOT NULL DEFAULT 0,
  voice_mime_type text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, conversation_id)
);

ALTER TABLE drafts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_drafts" ON drafts;
CREATE POLICY "select_own_drafts" ON drafts FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_drafts" ON drafts;
CREATE POLICY "insert_own_drafts" ON drafts FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_drafts" ON drafts;
CREATE POLICY "update_own_drafts" ON drafts FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_drafts" ON drafts;
CREATE POLICY "delete_own_drafts" ON drafts FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

-- Index for fast draft lookups
CREATE INDEX IF NOT EXISTS idx_drafts_user_conversation ON drafts(user_id, conversation_id);
