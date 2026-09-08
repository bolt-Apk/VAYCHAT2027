/*
# Fix search_path on check_leaked_password function

1. Modified Functions
   - `public.check_leaked_password(event jsonb)` — sets an immutable
     `search_path` to prevent search-path injection attacks.

2. Security
   - Sets `search_path = ''` so all object references must be
     schema-qualified (they already are: `extensions.digest`,
     `extensions.http_get`, `extensions.http_response`).
   - This prevents a malicious actor from placing rogue objects in
     a mutable search_path position.

3. Important Notes
   - The function body is unchanged; only the `SET search_path` and
     `SECURITY DEFINER` attributes are added.
   - Grants/revokes are re-applied to ensure consistency.
*/

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
