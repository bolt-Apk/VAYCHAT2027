/*
  # Create storage bucket for chat media
  
  Creates a public bucket for chat media (images, videos, voice messages)
  with appropriate access policies.
*/

INSERT INTO storage.buckets (id, name, public)
VALUES ('chat-media', 'chat-media', true);

CREATE POLICY "Authenticated users can upload media"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'chat-media');

CREATE POLICY "Users can delete own uploads"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'chat-media' AND (storage.foldername(name))[1] = auth.uid()::text);
