/*
# Add 'call' message type for call system messages in chat

1. Modified Tables
   - `messages`: Expanded `message_type` CHECK constraint to include 'call'

2. Changes
   - Drop old CHECK constraint on message_type
   - Add new CHECK constraint allowing: text, image, video, voice, file, location, video_note, contact, call
   - 'call' type: system messages inserted when a call ends, content stores JSON with call metadata
     (call_type, status, duration, call_id)

3. Important Notes
   - Non-destructive change - only widens the allowed values
   - Existing data is unaffected
   - Call messages will appear as centered system cards in the chat timeline
*/

ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_message_type_check;

ALTER TABLE messages ADD CONSTRAINT messages_message_type_check
  CHECK (message_type IN ('text', 'image', 'video', 'voice', 'file', 'location', 'video_note', 'contact', 'call'));
