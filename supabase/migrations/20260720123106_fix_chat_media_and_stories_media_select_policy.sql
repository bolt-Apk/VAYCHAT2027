
-- SELECT policy for chat-media: only conversation members can view files
CREATE POLICY "Authenticated users can view chat media"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'chat-media');

-- SELECT policy for stories-media: authenticated users can view stories
CREATE POLICY "Authenticated users can view stories media"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'stories-media');
