/*
# Expand stories-media bucket allowed MIME types

1. Changes
  - Add HEIC/HEIF image formats (iOS camera default)
  - Add AVIF image format (modern web)
  - Add audio/x-m4a and audio/aac (native recording formats)
  - Add video/3gpp (Android camera format)

2. Reason
  - iOS devices often produce HEIC images which were being rejected
  - Android devices may produce 3GPP video
  - This ensures all common media formats from all platforms are accepted
*/

UPDATE storage.buckets
SET allowed_mime_types = ARRAY[
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'image/heic', 'image/heif', 'image/avif',
  'video/mp4', 'video/webm', 'video/quicktime', 'video/3gpp',
  'audio/webm', 'audio/ogg', 'audio/mpeg', 'audio/mp4',
  'audio/x-m4a', 'audio/aac'
]
WHERE id = 'stories-media';
