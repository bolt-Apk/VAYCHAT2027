-- Add media_type column to user_statuses
ALTER TABLE user_statuses ADD COLUMN IF NOT EXISTS media_type text CHECK (media_type IN ('image', 'video'));

-- Create storage bucket for stories media
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'stories-media',
  'stories-media',
  true,
  52428800,
  ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'video/mp4', 'video/webm', 'video/quicktime']
)
ON CONFLICT (id) DO NOTHING;

-- Storage policies for stories-media bucket
CREATE POLICY "Authenticated users can upload stories media"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'stories-media' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Users can delete own stories media"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'stories-media' AND (storage.foldername(name))[1] = auth.uid()::text);
