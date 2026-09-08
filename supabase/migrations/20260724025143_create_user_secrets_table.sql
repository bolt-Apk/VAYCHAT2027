/*
# Create user_secrets table for sensitive security data

1. New Tables
  - `user_secrets`
    - `user_id` (uuid, primary key, references auth.users)
    - `security_settings` (jsonb) - contains PIN hash and lock settings
    - `updated_at` (timestamptz)

2. Security
  - RLS enabled with STRICT owner-only policies
  - Only the owning user can read/write their own secrets
  - This separates sensitive data from the publicly readable profiles table

3. Data Migration
  - Copies existing security_settings from profiles to user_secrets
  - Nulls out security_settings in profiles table

4. Important Notes
  - This fixes a critical security bug where PIN hashes were readable by any authenticated user
  - The profiles table SELECT policy allows any authenticated user to read all columns
  - By moving security_settings to a separate table with owner-only RLS, PIN hashes are protected
*/

-- Create the user_secrets table
CREATE TABLE IF NOT EXISTS user_secrets (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  security_settings jsonb DEFAULT '{}'::jsonb,
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE user_secrets ENABLE ROW LEVEL SECURITY;

-- Owner-only policies
DROP POLICY IF EXISTS "select_own_secrets" ON user_secrets;
CREATE POLICY "select_own_secrets" ON user_secrets FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_secrets" ON user_secrets;
CREATE POLICY "insert_own_secrets" ON user_secrets FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_secrets" ON user_secrets;
CREATE POLICY "update_own_secrets" ON user_secrets FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_secrets" ON user_secrets;
CREATE POLICY "delete_own_secrets" ON user_secrets FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

-- Migrate existing security_settings from profiles to user_secrets
INSERT INTO user_secrets (user_id, security_settings)
SELECT id, security_settings
FROM profiles
WHERE security_settings IS NOT NULL AND security_settings != '{}'::jsonb
ON CONFLICT (user_id) DO UPDATE SET security_settings = EXCLUDED.security_settings;

-- Clear security_settings from profiles (set to empty object)
UPDATE profiles SET security_settings = '{}'::jsonb WHERE security_settings IS NOT NULL AND security_settings != '{}'::jsonb;
