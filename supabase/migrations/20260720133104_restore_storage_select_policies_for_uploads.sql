/*
# Restore scoped SELECT policies on storage.objects for upload functionality

## Problem
The previous security migration (fix_security_advisor_findings) dropped all
SELECT policies on storage.objects for avatars, chat-media, and stories-media
buckets to prevent broad listing. However, Supabase storage requires SELECT
access on storage.objects for the x-upsert header to work — without it,
uploads fail because the storage engine cannot check if the object already
exists before deciding to INSERT or UPDATE.

## Changes
- Re-add SELECT policy for `avatars` bucket: scoped to the user's own folder
  (foldername[1] = auth.uid()) so users can only see their own avatar files.
- Re-add SELECT policy for `chat-media` bucket: scoped to the user's own
  folder so users can only see files they uploaded.
- Re-add SELECT policy for `stories-media` bucket: scoped to the user's own
  folder so users can only see files they uploaded.

## Security
- These policies NO LONGER allow listing all files in the bucket (the original
  security concern). Each user can only SELECT objects in their own subfolder.
- Public buckets still serve files via direct URL without SELECT policies;
  these SELECT policies only affect storage.objects queries (used internally
  by the upsert mechanism and by storage.list() API calls).
*/

-- Avatars: users can SELECT only their own folder
DROP POLICY IF EXISTS "Users can select own avatars" ON storage.objects;
CREATE POLICY "Users can select own avatars"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = (auth.uid())::text
  );

-- Chat media: users can SELECT only their own folder
DROP POLICY IF EXISTS "Users can select own chat media" ON storage.objects;
CREATE POLICY "Users can select own chat media"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'chat-media'
    AND (storage.foldername(name))[1] = (auth.uid())::text
  );

-- Stories media: users can SELECT only their own folder
DROP POLICY IF EXISTS "Users can select own stories media" ON storage.objects;
CREATE POLICY "Users can select own stories media"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'stories-media'
    AND (storage.foldername(name))[1] = (auth.uid())::text
  );
