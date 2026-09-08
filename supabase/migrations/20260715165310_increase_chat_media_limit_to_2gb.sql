/*
# Increase chat-media bucket file size limit to 2GB

1. Changes
   - Updates the file_size_limit on the chat-media storage bucket from 500MB to 2GB (2147483648 bytes)
   - This allows users to upload large video files and media

2. Important Notes
   - The bucket remains public with existing RLS policies unchanged
   - allowed_mime_types remains NULL (all types allowed)
*/

UPDATE storage.buckets
SET file_size_limit = 2147483648
WHERE id = 'chat-media';
