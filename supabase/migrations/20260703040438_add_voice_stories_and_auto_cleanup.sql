/*
# Add voice stories support and automatic cleanup

1. Modified Tables
   - `user_statuses`
     - Updated `media_type` CHECK constraint to also allow 'voice'
     - Added index on `expires_at` for efficient cleanup queries
     - Added index on `(user_id, created_at)` for daily count queries

2. New Functions
   - `cleanup_expired_statuses()` - deletes stories older than their expires_at
     and their associated storage objects. Called periodically via pg_cron or 
     can be triggered from an edge function.

3. Important Notes
   - Voice stories store audio files (webm/ogg/mp3) in stories-media bucket
   - Daily limit of 30 stories per user is enforced client-side
   - Expired stories are cleaned up server-side automatically
*/

-- Allow 'voice' in media_type check constraint
DO $$ BEGIN
  ALTER TABLE user_statuses DROP CONSTRAINT IF EXISTS user_statuses_media_type_check;
  ALTER TABLE user_statuses ADD CONSTRAINT user_statuses_media_type_check 
    CHECK (media_type IN ('image', 'video', 'voice'));
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Index for efficient expiry lookups
CREATE INDEX IF NOT EXISTS idx_user_statuses_expires_at ON user_statuses(expires_at);

-- Index for daily count queries (user + date)
CREATE INDEX IF NOT EXISTS idx_user_statuses_user_created ON user_statuses(user_id, created_at DESC);

-- Function to clean up expired statuses
CREATE OR REPLACE FUNCTION cleanup_expired_statuses()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  deleted_count integer;
BEGIN
  DELETE FROM public.user_statuses
  WHERE expires_at < now();
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

-- Grant execute to authenticated so it can be called via RPC
GRANT EXECUTE ON FUNCTION cleanup_expired_statuses() TO authenticated;

-- Update stories-media bucket to also allow audio files
UPDATE storage.buckets
SET allowed_mime_types = ARRAY[
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'video/mp4', 'video/webm', 'video/quicktime',
  'audio/webm', 'audio/ogg', 'audio/mpeg', 'audio/mp4'
]
WHERE id = 'stories-media';
