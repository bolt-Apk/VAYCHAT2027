
-- Add missing SELECT policy for avatars bucket (required for upsert to work)
CREATE POLICY "Public can view avatars"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'avatars');
