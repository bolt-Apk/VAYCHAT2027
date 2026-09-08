/*
# Fix cleanup_expired_statuses to also delete storage files

The old public.cleanup_expired_statuses() deleted user_statuses rows but
left the associated media files in the stories-media bucket, accumulating
~700 MB of orphans. This migration drops the old function and recreates it
in the private schema with storage-object deletion before each row delete.
*/

DROP FUNCTION IF EXISTS public.cleanup_expired_statuses() CASCADE;

CREATE OR REPLACE FUNCTION private.cleanup_expired_statuses()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  expired RECORD;
  deleted_count integer := 0;
BEGIN
  FOR expired IN
    SELECT id, media_url
    FROM public.user_statuses
    WHERE expires_at < now()
      AND media_url IS NOT NULL
  LOOP
    BEGIN
      IF expired.media_url LIKE '%/stories-media/%' THEN
        PERFORM private.delete_storage_object(
          'stories-media',
          substring(expired.media_url from '/stories-media/(.*)')
        );
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Storage delete failed for status %: %', expired.id, SQLERRM;
    END;

    DELETE FROM public.user_statuses WHERE id = expired.id;
    deleted_count := deleted_count + 1;
  END LOOP;

  RETURN deleted_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION private.cleanup_expired_statuses() FROM anon, authenticated, public;
