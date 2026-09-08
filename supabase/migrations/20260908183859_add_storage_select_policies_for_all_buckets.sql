/*
# Add missing SELECT policies for stories-media and chat-media storage buckets

## Problem
The `stories-media` and `chat-media` buckets have INSERT, UPDATE, and DELETE
policies but are missing SELECT policies for authenticated users. This causes
several issues:
1. When using `upsert: true`, storage needs to SELECT the existing object first
   to decide between INSERT and UPDATE. Without SELECT, the upsert always tries
   INSERT, which fails with "new row violates row-level security policy" if the
   file already exists.
2. Even without upsert, the Supabase client SDK may internally check object
   existence via SELECT before upload, which silently fails and can cause
   unexpected upload errors.

## Fix
- Add a SELECT policy on storage.objects for the `stories-media` bucket,
  scoped to authenticated users reading only objects in their own folder.
- Add a SELECT policy on storage.objects for the `chat-media` bucket,
  scoped to authenticated users reading only objects in their own folder.

## Security
- Both policies are scoped by `auth.uid()` to the user's own folder only.
- These buckets are already public for read access via public URLs; the SELECT
  policy only governs the storage API (listing/checking), not public URL access.
*/

-- stories-media: SELECT policy for authenticated users (own folder)
DROP POLICY IF EXISTS "Users can select own stories media" ON storage.objects;
CREATE POLICY "Users can select own stories media"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'stories-media'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- chat-media: SELECT policy for authenticated users (own folder)
DROP POLICY IF EXISTS "Users can select own chat media" ON storage.objects;
CREATE POLICY "Users can select own chat media"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'chat-media'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- stories-media: UPDATE policy (was also missing, needed for re-uploads)
DROP POLICY IF EXISTS "Users can update own stories media" ON storage.objects;
CREATE POLICY "Users can update own stories media"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'stories-media'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'stories-media'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
