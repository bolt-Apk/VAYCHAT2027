-- 1. Move update_conversation_timestamp to private schema with fixed search_path
--    and revoke public execute access.

-- Drop the trigger that references the old function
DROP TRIGGER IF EXISTS on_message_insert ON messages;

-- Drop the old public function
DROP FUNCTION IF EXISTS public.update_conversation_timestamp();

-- Recreate in private schema with search_path set
CREATE OR REPLACE FUNCTION private.update_conversation_timestamp()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.conversations SET updated_at = now() WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$;

-- Revoke execute from public roles
REVOKE ALL ON FUNCTION private.update_conversation_timestamp() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.update_conversation_timestamp() FROM anon;
REVOKE ALL ON FUNCTION private.update_conversation_timestamp() FROM authenticated;

-- Recreate the trigger pointing to the private function
CREATE TRIGGER on_message_insert
  BEFORE INSERT ON messages
  FOR EACH ROW
  EXECUTE FUNCTION private.update_conversation_timestamp();

-- 2. Drop duplicate/overly-permissive policies on conversations

-- conversations_insert: WITH CHECK (true) — replaced by "Users can create conversations as themselves"
DROP POLICY IF EXISTS "conversations_insert" ON conversations;

-- conversations_update: WITH CHECK (true) — replaced by "Admins can update conversations"
DROP POLICY IF EXISTS "conversations_update" ON conversations;

-- conversations_select uses self-referencing subquery on conversation_members;
-- "Members can view their conversations" already uses the safe helper function
DROP POLICY IF EXISTS "conversations_select" ON conversations;
