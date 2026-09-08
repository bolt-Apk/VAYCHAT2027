/*
  # Add settings columns to profiles table

  1. Modified Tables
    - `profiles`
      - `notification_settings` (jsonb) - stores notification preferences
      - `privacy_settings` (jsonb) - stores privacy preferences
      - `appearance_settings` (jsonb) - stores appearance preferences

  2. Notes
    - All columns are nullable with no default (null = use app defaults)
    - No data loss, only adds new optional columns
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'profiles' AND column_name = 'notification_settings'
  ) THEN
    ALTER TABLE profiles ADD COLUMN notification_settings jsonb;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'profiles' AND column_name = 'privacy_settings'
  ) THEN
    ALTER TABLE profiles ADD COLUMN privacy_settings jsonb;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'profiles' AND column_name = 'appearance_settings'
  ) THEN
    ALTER TABLE profiles ADD COLUMN appearance_settings jsonb;
  END IF;
END $$;
