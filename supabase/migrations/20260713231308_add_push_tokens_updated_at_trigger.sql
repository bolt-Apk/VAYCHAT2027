/*
# Add auto-update trigger for push_tokens.updated_at

1. Changes
   - Creates a trigger function to automatically set `updated_at` on row updates.
   - Attaches trigger to `push_tokens` table.
   - This allows tracking token freshness for stale token cleanup.

2. Security
   - No RLS changes. Function is SECURITY INVOKER (default).
*/

CREATE OR REPLACE FUNCTION private.set_push_token_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_push_token_updated_at ON push_tokens;
CREATE TRIGGER set_push_token_updated_at
  BEFORE UPDATE ON push_tokens
  FOR EACH ROW
  EXECUTE FUNCTION private.set_push_token_updated_at();
