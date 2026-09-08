/*
# Remove file size limit on chat-media bucket

1. Changes
  - Sets file_size_limit on chat-media bucket to 500MB to allow large video uploads
  - Previously was NULL (Supabase default ~50MB)

2. Reason
  - Users need to send large video files without restrictions
*/

UPDATE storage.buckets
SET file_size_limit = 524288000
WHERE id = 'chat-media';
