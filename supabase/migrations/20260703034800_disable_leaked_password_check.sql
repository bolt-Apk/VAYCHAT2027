/*
# Disable leaked password verification hook

1. Modified Functions
   - `public.check_leaked_password(event jsonb)` -- now always returns 'continue'
     instead of checking the HaveIBeenPwned API.

2. Reason
   - The app uses 4-6 digit numeric PIN codes as passwords.
   - Nearly all short numeric PINs appear in breach databases,
     which blocks most users from registering.
   - The HIBP check is designed for real passwords, not PIN codes.

3. Security
   - The function still exists so the auth hook reference remains valid.
   - It simply always allows the password through.
*/

CREATE OR REPLACE FUNCTION public.check_leaked_password(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN jsonb_build_object(
    'decision', 'continue',
    'message', 'Password check skipped for PIN-based auth'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_leaked_password(jsonb) TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION public.check_leaked_password(jsonb) FROM authenticated, anon, public;
