/*
# Create Leaked Password Verification Hook

1. New Functions
   - `public.check_leaked_password(event jsonb)` — a Supabase Auth hook function
     that runs during password-based signup and password changes.
   - Uses k-anonymity to check the HaveIBeenPwned API:
     a. SHA-1 hashes the password.
     b. Sends the first 5 chars of the hash to the HIBP range API.
     c. Checks if the remaining suffix appears in the response.
     d. If found, returns a decision to reject the password.
     e. If not found or on API error, allows the password (fail-open).

2. Security
   - The full password hash never leaves the database.
   - Only 5 hex chars (the prefix) are sent to the external API.
   - On any HTTP error the function fails open (allows the password)
     to avoid blocking signups when the API is down.

3. Important Notes
   - Requires the `http` extension (installed in prior migration).
   - Uses `pgcrypto` (already installed) for SHA-1 digest.
   - The function signature matches Supabase Auth hook expectations:
     accepts jsonb, returns jsonb with `decision` and optional `message`.
*/

CREATE OR REPLACE FUNCTION public.check_leaked_password(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
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
