-- Public buckets serve files via URL without SELECT policies.
-- Broad SELECT policies only enable listing all files via the API, which is a security risk.
-- Replace with restricted policies that only let authenticated users list their own files.

-- Drop broad SELECT policies
DROP POLICY IF EXISTS "Anyone can view avatars" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can view chat media" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can view stories media" ON storage.objects;

-- Avatars, chat-media, stories-media: no SELECT policy.
-- Public buckets serve objects via CDN URL without RLS; the app only uses
-- getPublicUrl(), so a SELECT policy only enables API file enumeration.
