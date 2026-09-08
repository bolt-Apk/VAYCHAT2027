/*
# Storage cleanup helper function

Adds a SECURITY DEFINER helper to delete a storage object by bucket + path.
Used by the status and orphan cleanup functions. Lives in the private schema
so it bypasses storage RLS while being uncallable by anon/authenticated roles.
*/

CREATE OR REPLACE FUNCTION private.delete_storage_object(bucket text, obj_name text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  DELETE FROM storage.objects
  WHERE bucket_id = bucket AND name = obj_name;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Failed to delete %/%: %', bucket, obj_name, SQLERRM;
END;
$$;

REVOKE EXECUTE ON FUNCTION private.delete_storage_object(text, text) FROM anon, authenticated, public;
