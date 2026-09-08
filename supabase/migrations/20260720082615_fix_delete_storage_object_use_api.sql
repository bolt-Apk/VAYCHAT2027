/*
# Fix delete_storage_object to use the Storage API

Direct DELETE from storage.objects is blocked by a Supabase trigger
(storage.protect_delete). The correct way to delete a file is the
Storage REST API: DELETE {supabase_url}/storage/v1/object/{bucket}/{path}
authenticated with the service role key.

pg_net's http_delete is async (returns a request id); we collect the
response synchronously with http_collect_response(..., async := false).
Credentials are read from vault secrets (same pattern as the push
notification triggers).

The function signature changes (returns boolean instead of void), so
we drop the old version first.
*/

DROP FUNCTION IF EXISTS private.delete_storage_object(text, text) CASCADE;

CREATE OR REPLACE FUNCTION private.delete_storage_object(bucket text, obj_name text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_url text;
  v_key text;
  v_req_id bigint;
  v_resp jsonb;
  v_status integer;
BEGIN
  v_url := current_setting('app.settings.supabase_url', true);
  IF v_url IS NULL OR v_url = '' THEN
    SELECT decrypted_secret INTO v_url
    FROM vault.decrypted_secrets
    WHERE name = 'supabase_url' LIMIT 1;
  END IF;

  v_key := current_setting('app.settings.service_role_key', true);
  IF v_key IS NULL OR v_key = '' THEN
    SELECT decrypted_secret INTO v_key
    FROM vault.decrypted_secrets
    WHERE name = 'service_role_key' LIMIT 1;
  END IF;

  IF v_url IS NULL OR v_key IS NULL THEN
    RAISE NOTICE 'Missing supabase_url or service_role_key';
    RETURN false;
  END IF;

  SELECT id INTO v_req_id
  FROM net.http_delete(
    url := v_url || '/storage/v1/object/' || bucket || '/' || obj_name,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_key,
      'apikey', v_key
    ),
    timeout_milliseconds := 10000
  );

  SELECT content INTO v_resp
  FROM net.http_collect_response(v_req_id, async := false);

  v_status := (v_resp ->> 'status')::integer;

  IF v_status = 200 OR v_status = 404 THEN
    RETURN true;
  END IF;

  RAISE NOTICE 'Storage API delete %/% returned status %: %',
    bucket, obj_name, v_status, v_resp;
  RETURN false;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'delete_storage_object %/% error: %', bucket, obj_name, SQLERRM;
  RETURN false;
END;
$$;

REVOKE EXECUTE ON FUNCTION private.delete_storage_object(text, text) FROM anon, authenticated, public;
