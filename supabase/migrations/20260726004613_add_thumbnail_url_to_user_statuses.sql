/*
# Add thumbnail_url to user_statuses

1. Modified Tables
   - `user_statuses`
     - Added `thumbnail_url` (text, nullable) - stores a URL to a generated thumbnail image for video and voice stories

2. Important Notes
   - This allows stories to display a visual preview in the story circle
   - For video stories: a captured frame from the video
   - For voice stories: could store a waveform image (optional, background_color used instead)
*/

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'user_statuses'
    AND column_name = 'thumbnail_url'
  ) THEN
    ALTER TABLE user_statuses ADD COLUMN thumbnail_url text;
  END IF;
END $$;
