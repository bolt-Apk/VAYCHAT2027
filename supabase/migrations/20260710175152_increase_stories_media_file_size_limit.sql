/*
# Increase stories-media bucket file size limit

1. Changes
  - Updates file_size_limit on stories-media bucket from 50MB to 500MB
  - Allows users to upload large video stories without restrictions

2. Reason
  - Users should be able to post stories with large video files
*/

UPDATE storage.buckets
SET file_size_limit = 524288000
WHERE id = 'stories-media';
