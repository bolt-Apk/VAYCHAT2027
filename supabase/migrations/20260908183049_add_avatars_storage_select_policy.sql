/*
# Add missing SELECT policy for avatars storage bucket

## Problem
The avatars bucket has INSERT, UPDATE, and DELETE policies but no SELECT policy
for authenticated users. When uploading with `upsert: true`, the storage layer
needs to SELECT the existing object to decide between INSERT and UPDATE. Without
a SELECT policy, the upsert always attempts INSERT, which fails with
"new row violates row-level security policy" when the avatar file already exists.

## Fix
- Add a SELECT policy on storage.objects for the avatars bucket.
- The bucket is already public (anyone can read via public URL), so the SELECT
  policy allows authenticated users to list/check their own avatar objects.
  This is needed for the upsert check, not for reading the file content.

## Security
- Scoped to authenticated users reading only their own folder.
*/

DROP POLICY IF EXISTS "Users can select own avatar" ON storage.objects;
CREATE POLICY "Users can select own avatar"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
