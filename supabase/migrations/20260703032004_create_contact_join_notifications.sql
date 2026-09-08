/*
# Contact Join Notifications System

Implements Telegram-style "X joined VayChat!" notifications.

1. New Tables
  - `pending_contacts`
    - `id` (uuid, primary key)
    - `user_id` (uuid, FK to profiles) - the user who saved this phone number
    - `phone` (text, not null) - phone number of the person not yet registered
    - `nickname` (text, nullable) - optional name for this pending contact
    - `created_at` (timestamptz)
    - Unique constraint on (user_id, phone)
  - `contact_join_notifications`
    - `id` (uuid, primary key)
    - `user_id` (uuid, FK to profiles) - the user who should see the notification
    - `joined_user_id` (uuid, FK to profiles) - the user who just joined
    - `is_read` (boolean, default false)
    - `created_at` (timestamptz)

2. Functions & Triggers
  - `on_profile_display_name_set()` - fires on UPDATE of profiles
    when display_name changes from '' to a non-empty value (profile setup completed).
    Checks pending_contacts for this user's phone, creates notifications,
    auto-creates real contacts, and cleans up pending entries.

3. Security
  - RLS enabled on both tables with owner-scoped policies.
  - Trigger function runs as SECURITY DEFINER to access cross-user data.

4. Realtime
  - contact_join_notifications added to supabase_realtime publication.
*/

-- pending_contacts: stores phone numbers of people not yet on VayChat
CREATE TABLE IF NOT EXISTS pending_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES profiles(id) ON DELETE CASCADE,
  phone text NOT NULL,
  nickname text,
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, phone)
);

ALTER TABLE pending_contacts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_pending_contacts" ON pending_contacts;
CREATE POLICY "select_own_pending_contacts" ON pending_contacts FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_pending_contacts" ON pending_contacts;
CREATE POLICY "insert_own_pending_contacts" ON pending_contacts FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_pending_contacts" ON pending_contacts;
CREATE POLICY "update_own_pending_contacts" ON pending_contacts FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_pending_contacts" ON pending_contacts;
CREATE POLICY "delete_own_pending_contacts" ON pending_contacts FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

-- contact_join_notifications: "X joined VayChat!" notifications
CREATE TABLE IF NOT EXISTS contact_join_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  joined_user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE contact_join_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_join_notifications" ON contact_join_notifications;
CREATE POLICY "select_own_join_notifications" ON contact_join_notifications FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_join_notifications" ON contact_join_notifications;
CREATE POLICY "insert_join_notifications" ON contact_join_notifications FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_join_notifications" ON contact_join_notifications;
CREATE POLICY "update_own_join_notifications" ON contact_join_notifications FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_join_notifications" ON contact_join_notifications;
CREATE POLICY "delete_own_join_notifications" ON contact_join_notifications FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

-- Trigger function: when a user completes profile setup, notify everyone who had their phone saved
CREATE OR REPLACE FUNCTION on_profile_display_name_set()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pending RECORD;
BEGIN
  -- Only fire when display_name changes from empty to non-empty (profile setup)
  IF (OLD.display_name IS NOT NULL AND OLD.display_name <> '') THEN
    RETURN NEW;
  END IF;
  IF (NEW.display_name IS NULL OR NEW.display_name = '') THEN
    RETURN NEW;
  END IF;

  -- Find all pending_contacts entries that match this user's phone
  FOR pending IN
    SELECT pc.id, pc.user_id, pc.nickname
    FROM pending_contacts pc
    WHERE pc.phone = NEW.phone
  LOOP
    -- Create a join notification
    INSERT INTO contact_join_notifications (user_id, joined_user_id)
    VALUES (pending.user_id, NEW.id)
    ON CONFLICT DO NOTHING;

    -- Auto-create a real contact entry
    INSERT INTO contacts (user_id, contact_id, nickname)
    VALUES (pending.user_id, NEW.id, pending.nickname)
    ON CONFLICT (user_id, contact_id) DO NOTHING;

    -- Remove the pending contact
    DELETE FROM pending_contacts WHERE id = pending.id;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_profile_display_name_set ON profiles;
CREATE TRIGGER trigger_profile_display_name_set
  AFTER UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION on_profile_display_name_set();

-- Enable realtime for join notifications
ALTER PUBLICATION supabase_realtime ADD TABLE contact_join_notifications;
