
-- Fix: RLS policies on conversations/conversation_members call get_user_conversation_ids()
-- but EXECUTE was revoked from authenticated/anon, breaking every query with
-- "permission denied for function get_user_conversation_ids".
-- Re-grant EXECUTE on the public-facing function to the roles used by client requests.

GRANT EXECUTE ON FUNCTION public.get_user_conversation_ids(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_conversation_ids(uuid) TO anon;
GRANT EXECUTE ON FUNCTION private.get_user_conversation_ids(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.get_user_conversation_ids(uuid) TO anon;
