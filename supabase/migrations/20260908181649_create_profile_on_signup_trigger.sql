/*
# Auto-create profile on user signup + backfill missing profiles

1. New Function
  - `public.handle_new_user()` — trigger function that creates a profile row
    whenever a new user is inserted into auth.users.

2. New Trigger
  - `on_auth_user_created` on auth.users AFTER INSERT — calls the function above.

3. Data Backfill
  - Inserts a profile row for every auth.users entry that is missing one.

4. Security
  - Function is SECURITY DEFINER (runs as owner, bypasses RLS).
  - Execute revoked from anon/authenticated.
*/

CREATE SCHEMA IF NOT EXISTS private;

-- Create the trigger function
CREATE OR REPLACE FUNCTION private.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
BEGIN
  INSERT INTO public.profiles (id, phone, display_name)
  VALUES (NEW.id, COALESCE(NEW.email, NEW.id::text), '')
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- Revoke execute from public roles
REVOKE ALL ON FUNCTION private.handle_new_user() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.handle_new_user() FROM anon;
REVOKE ALL ON FUNCTION private.handle_new_user() FROM authenticated;

-- Create trigger on auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION private.handle_new_user();

-- Backfill: create profile rows for any existing auth users missing one
INSERT INTO public.profiles (id, phone, display_name)
SELECT u.id, COALESCE(u.email, u.id::text), ''
FROM auth.users u
LEFT JOIN public.profiles p ON p.id = u.id
WHERE p.id IS NULL
ON CONFLICT (id) DO NOTHING;
