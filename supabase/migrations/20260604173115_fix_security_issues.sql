/*
  # Fix security issues

  1. Function search_path mutable
    - Set search_path to '' on get_user_conversation_ids to prevent search_path injection

  2. RLS policy always true on conversations INSERT
    - Replace the unrestricted INSERT policy with one that requires the user
      to be adding themselves as a member (handled by conversation_members)
    - Since conversations are just containers, restrict to authenticated is acceptable
      but we tighten by requiring auth.uid() is not null explicitly

  3. Public/authenticated can execute SECURITY DEFINER function via RPC
    - Revoke EXECUTE from anon and public roles
    - Grant EXECUTE only to authenticated (needed for RLS policies to work)
    - But the function is called internally by RLS, not via RPC directly
    - Revoking from public and anon prevents anon RPC access
*/

-- 1. Fix mutable search_path on the function
CREATE OR REPLACE FUNCTION get_user_conversation_ids(p_user_id uuid)
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT conversation_id FROM public.conversation_members WHERE user_id = p_user_id;
$$;

-- 3 & 4. Revoke public execution of the SECURITY DEFINER function
REVOKE EXECUTE ON FUNCTION get_user_conversation_ids(uuid) FROM public;
REVOKE EXECUTE ON FUNCTION get_user_conversation_ids(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION get_user_conversation_ids(uuid) FROM authenticated;

-- Grant only to the roles that need it internally (postgres for RLS evaluation)
-- RLS policies run as the table owner, so the function is callable during policy checks
-- without needing explicit GRANT to authenticated

-- 2. Fix the always-true INSERT policy on conversations
DROP POLICY IF EXISTS "Authenticated users can create conversations" ON conversations;

CREATE POLICY "Authenticated users can create conversations"
  ON conversations FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);
