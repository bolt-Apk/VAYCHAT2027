/*
# Disable unused GraphQL API and re-enable leaked password protection

## Background
The security advisor flags 26 tables as visible to `authenticated` in the
GraphQL schema. pg_graphql derives table visibility from the same PostgreSQL
`SELECT` grants that PostgREST (the REST Data API) uses. The application is
REST-only — a codebase-wide search for `graphql`, `/graphql/v1`, and `hasura`
returned zero matches — so the GraphQL API is entirely unused.

Revoking `SELECT` from `authenticated` to satisfy the advisor would also
remove REST access and break the app. Dropping the `pg_graphql` extension
instead eliminates the GraphQL endpoint (`/graphql/v1`) entirely, which
resolves all 26 visibility findings without touching the REST API.

## Changes

### 1. Drop the pg_graphql extension (GraphQL API)
- `DROP EXTENSION IF EXISTS pg_graphql CASCADE;`
- Removes the `/graphql/v1` endpoint and all GraphQL schema introspection.
- The `graphql` and `graphql_public` schemas are owned by the extension and
  are dropped automatically by `CASCADE`.
- REST API (PostgREST) is completely unaffected — it does not depend on
  pg_graphql.

### 2. Re-enable leaked password protection with PIN exemption
The app uses 4-6 digit numeric PIN codes as passwords. Nearly every short
numeric PIN appears in the HaveIBeenPwned breach database, so a naive HIBP
check blocks most users from registering. The previous migration
(`20260703034800_disable_leaked_password_check.sql`) worked around this by
making `check_leaked_password` always return `continue`, which disabled
protection entirely.

This migration restores the real HIBP k-anonymity check but exempts purely
numeric PINs of 4-6 digits. Real passwords (letters, symbols, longer codes)
are still checked against HIBP and rejected if compromised. PINs are
validated by the app's own rate-limiting and account-lockout logic instead.

- `public.check_leaked_password(event jsonb)` is restored to the original
  HIBP k-anonymity implementation (SHA-1 prefix lookup) with one added
  branch: if the password matches `^[0-9]{4,6}$`, it returns `continue`
  without calling HIBP.
- `SECURITY DEFINER` and `SET search_path = ''` are retained for safety.
- `EXECUTE` is granted only to `supabase_auth_admin` and revoked from
  `authenticated`, `anon`, and `public`.

## Security
- GraphQL endpoint removed — no schema introspection possible.
- HIBP breach check active for all non-PIN passwords.
- `check_leaked_password` callable only by the auth admin role.
*/

-- 1. Drop the unused GraphQL API.
-- pg_graphql is the engine behind /graphql/v1. The app is REST-only.
-- CASCADE drops the graphql and graphql_public schemas (extension-owned).
DROP EXTENSION IF EXISTS pg_graphql CASCADE;

-- 2. Restore the leaked password hook with a PIN exemption.
-- Original HIBP k-anonymity check from migration 20260702235122, plus an
-- early return for 4-6 digit numeric PINs used by this app.
CREATE OR REPLACE FUNCTION public.check_leaked_password(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  password_text text;
  sha1_hash text;
  hash_prefix text;
  hash_suffix text;
  response extensions.http_response;
  response_lines text[];
  line text;
  line_parts text[];
BEGIN
  password_text := event->'password'->>'value';

  IF password_text IS NULL OR password_text = '' THEN
    RETURN jsonb_build_object(
      'decision', 'continue',
      'message', 'No password to check'
    );
  END IF;

  -- Exempt short numeric PINs (the app's auth model). Nearly all appear
  -- in breach databases; they are protected by app-side rate limiting and
  -- account lockout instead.
  IF password_text ~ '^[0-9]{4,6}$' THEN
    RETURN jsonb_build_object(
      'decision', 'continue',
      'message', 'PIN code exempt from breach check'
    );
  END IF;

  sha1_hash := upper(encode(extensions.digest(password_text, 'sha1'), 'hex'));
  hash_prefix := substring(sha1_hash from 1 for 5);
  hash_suffix := substring(sha1_hash from 6);

  BEGIN
    SELECT * INTO response
    FROM extensions.http_get(
      'https://api.pwnedpasswords.com/range/' || hash_prefix
    );
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'decision', 'continue',
      'message', 'Could not verify password safety'
    );
  END;

  IF response.status != 200 THEN
    RETURN jsonb_build_object(
      'decision', 'continue',
      'message', 'Could not verify password safety'
    );
  END IF;

  response_lines := string_to_array(response.content, E'\n');

  FOREACH line IN ARRAY response_lines
  LOOP
    line := trim(line);
    IF line = '' THEN
      CONTINUE;
    END IF;
    line_parts := string_to_array(line, ':');
    IF line_parts[1] = hash_suffix THEN
      IF (line_parts[2])::int > 0 THEN
        RETURN jsonb_build_object(
          'decision', 'reject',
          'message', 'This password has been found in a data breach. Please choose a different password.'
        );
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'decision', 'continue',
    'message', 'Password is safe'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_leaked_password(jsonb) TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION public.check_leaked_password(jsonb) FROM authenticated, anon, public;
