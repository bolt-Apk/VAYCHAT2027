/*
# Add public_key column to profiles for E2E encryption

1. Modified Tables
   - `profiles`
     - `public_key` (text, nullable) - stores the user's ECDH P-256 public key in JWK format for end-to-end encryption key agreement

2. Security
   - No policy changes needed - existing profiles SELECT/UPDATE policies apply
   - Public keys are intentionally readable by any authenticated user (needed for encryption)

3. Notes
   - The public key is in JWK JSON format for Web Crypto API compatibility
   - Private keys are stored device-side only (never on server)
*/

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'public_key'
  ) THEN
    ALTER TABLE profiles ADD COLUMN public_key text;
  END IF;
END $$;
