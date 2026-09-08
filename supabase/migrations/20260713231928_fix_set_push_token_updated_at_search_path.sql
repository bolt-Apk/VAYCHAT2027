/*
# Fix mutable search_path on private.set_push_token_updated_at

1. Changes
   - Sets `search_path = ''` on the function to prevent search path manipulation.

2. Security
   - Eliminates the "Function Search Path Mutable" warning.
*/

CREATE OR REPLACE FUNCTION private.set_push_token_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
