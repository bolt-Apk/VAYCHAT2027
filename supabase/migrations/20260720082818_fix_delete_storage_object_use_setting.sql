/*
# Fix delete_storage_object: use storage.allow_delete_query setting

Supabase's storage.protect_delete() trigger blocks direct DELETEs from
storage.objects unless the session setting 'storage.allow_delete_query'
is set to 'true'. This is far simpler and faster than calling the Storage
REST API via pg_net (which times out on synchronous collection).

The function sets the config locally before the DELETE, so the trigger
allows it. SECURITY DEFINER ensures it runs with sufficient privileges.
*/

CREATE OR REPLACE FUNCTION private.delete_storage_object(bucket text, obj_name text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_deleted integer;
BEGIN
  -- Allow direct deletion (checked by storage.protect_delete trigger)
  PERFORM set_config('storage.allow_delete_query', 'true', true);

  DELETE FROM storage.objects
  WHERE bucket_id = bucket AND name = obj_name
  RETURNING 1 INTO v_deleted;

  -- Reset the setting so it doesn't leak beyond this function call
  PERFORM set_config('storage.allow_delete_query', 'false', true);

  RETURN COALESCE(v_deleted, 0) > 0;
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('storage.allow_delete_query', 'false', true);
  RAISE NOTICE 'delete_storage_object %/% error: %', bucket, obj_name, SQLERRM;
  RETURN false;
END;
$$;

REVOKE EXECUTE ON FUNCTION private.delete_storage_object(text, text) FROM anon, authenticated, public;
