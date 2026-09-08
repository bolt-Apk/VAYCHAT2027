/*
# Add call_participants table and group call support

1. New Tables
   - `call_participants`
     - `id` (uuid, primary key)
     - `call_id` (uuid, FK to calls) - the call this participant belongs to
     - `user_id` (uuid, FK to auth.users) - the participant
     - `status` (text) - 'ringing', 'active', 'declined', 'missed', 'left'
     - `joined_at` (timestamptz) - when the participant joined
     - `left_at` (timestamptz) - when the participant left
     - `is_screen_sharing` (boolean) - whether participant is sharing screen
     - `created_at` (timestamptz)

2. Modified Tables
   - `calls`: Added `is_group_call` (boolean, default false) and `group_name` (text, nullable)

3. Security
   - Enable RLS on `call_participants`
   - Participants can view other participants in the same call
   - Users can insert themselves as participants
   - Users can update their own participant record
   - Users can delete their own participant record

4. Indexes
   - idx_call_participants_call_id for fast lookup by call
   - idx_call_participants_user_id for fast lookup by user

5. Realtime
   - Enable realtime on call_participants for live participant updates
*/

-- Add group call columns to calls table
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'calls' AND column_name = 'is_group_call'
  ) THEN
    ALTER TABLE calls ADD COLUMN is_group_call boolean NOT NULL DEFAULT false;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'calls' AND column_name = 'group_name'
  ) THEN
    ALTER TABLE calls ADD COLUMN group_name text;
  END IF;
END $$;

-- Create call_participants table
CREATE TABLE IF NOT EXISTS call_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id uuid NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'ringing',
  joined_at timestamptz,
  left_at timestamptz,
  is_screen_sharing boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now(),
  UNIQUE(call_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_call_participants_call_id ON call_participants(call_id);
CREATE INDEX IF NOT EXISTS idx_call_participants_user_id ON call_participants(user_id, created_at DESC);

ALTER TABLE call_participants ENABLE ROW LEVEL SECURITY;

-- Participants can see other participants in the same call
DROP POLICY IF EXISTS "select_call_participants" ON call_participants;
CREATE POLICY "select_call_participants" ON call_participants FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM call_participants cp
      WHERE cp.call_id = call_participants.call_id
      AND cp.user_id = auth.uid()
    )
  );

-- Users can be added as participants (caller adds them or they join)
DROP POLICY IF EXISTS "insert_call_participants" ON call_participants;
CREATE POLICY "insert_call_participants" ON call_participants FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM calls
      WHERE calls.id = call_id
      AND (calls.caller_id = auth.uid() OR call_participants.user_id = auth.uid())
    )
  );

-- Users can update their own participant record
DROP POLICY IF EXISTS "update_own_call_participant" ON call_participants;
CREATE POLICY "update_own_call_participant" ON call_participants FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Users can delete their own participant record
DROP POLICY IF EXISTS "delete_own_call_participant" ON call_participants;
CREATE POLICY "delete_own_call_participant" ON call_participants FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- Enable realtime for call_participants
ALTER TABLE call_participants REPLICA IDENTITY FULL;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'call_participants'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE call_participants;
  END IF;
END $$;
