/*
# Add video_note, contact, and location message types

1. Modified Tables
   - `messages`: Expanded `message_type` CHECK constraint to include 'video_note', 'contact', and 'location'

2. Changes
   - Drop old CHECK constraint on message_type (only allowed text/image/video/voice/file)
   - Add new CHECK constraint allowing: text, image, video, voice, file, location, video_note, contact
   - video_note: circular video messages (like Telegram circles)
   - contact: shared contact cards with name/phone stored as JSON in content
   - location: geographic coordinates (was already used in frontend but missing from DB constraint)

3. Important Notes
   - This is a non-destructive change - only widens the allowed values
   - Existing data is unaffected
*/

ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_message_type_check;

ALTER TABLE messages ADD CONSTRAINT messages_message_type_check
  CHECK (message_type IN ('text', 'image', 'video', 'voice', 'file', 'location', 'video_note', 'contact'));
