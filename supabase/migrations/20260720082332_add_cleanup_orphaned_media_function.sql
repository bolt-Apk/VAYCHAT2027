/*
# Add cleanup_orphaned_media function

New function that scans the chat-media and stories-media storage buckets
for objects not referenced by any messages.media_url or
user_statuses.media_url, and deletes them. Only sweeps files older than
1 hour so in-progress uploads are never deleted. Processes in batches
(default 200) to stay within timeout limits.
*/

CREATE OR REPLACE FUNCTION private.cleanup_orphaned_media(batch_size integer DEFAULT 200)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  orphan RECORD;
  deleted_count integer := 0;
BEGIN
  FOR orphan IN
    SELECT o.bucket_id, o.name, o.created_at
    FROM storage.objects o
    WHERE o.bucket_id IN ('chat-media', 'stories-media')
      AND NOT EXISTS (
        SELECT 1 FROM public.messages m
        WHERE m.media_url LIKE '%/' || o.name
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.user_statuses s
        WHERE s.media_url LIKE '%/' || o.name
      )
      AND o.created_at < now() - interval '1 hour'
    ORDER BY o.created_at ASC
    LIMIT batch_size
  LOOP
    PERFORM private.delete_storage_object(orphan.bucket_id, orphan.name);
    deleted_count := deleted_count + 1;
  END LOOP;

  RETURN deleted_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION private.cleanup_orphaned_media(integer) FROM anon, authenticated, public;
