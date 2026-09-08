/*
  # Grant execute permission on get_user_conversation_ids

  1. Problem
    - Authenticated users get "permission denied for function get_user_conversation_ids"
    - Multiple RLS policies on conversations, conversation_members, and messages
      reference this function

  2. Fix
    - Grant EXECUTE on the function to authenticated role
*/

GRANT EXECUTE ON FUNCTION get_user_conversation_ids(uuid) TO authenticated;
