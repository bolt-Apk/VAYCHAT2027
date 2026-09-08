/*
# Revoke direct API access to get_user_conversation_ids

## Problem
The function `public.get_user_conversation_ids(uuid)` is SECURITY DEFINER and
callable by authenticated users via `/rest/v1/rpc/get_user_conversation_ids`.
While it already checks `p_user_id = auth.uid()`, exposing a SECURITY DEFINER
function on the API is an unnecessary privilege escalation surface.

## Fix
- Revoke EXECUTE from anon and authenticated roles so the function cannot be
  called directly through the REST API.
- The function remains callable inside RLS policy evaluation (which runs as
  the table owner), so all 6 policies that reference it continue to work.

## Important Notes
1. The function must stay SECURITY DEFINER because it is called from RLS
   policies on `conversation_members`; switching to INVOKER would cause
   infinite recursion (the policy would re-evaluate itself when the function
   reads `conversation_members`).
2. No application code calls this function via `.rpc()`.
*/

REVOKE EXECUTE ON FUNCTION public.get_user_conversation_ids(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_user_conversation_ids(uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.get_user_conversation_ids(uuid) FROM PUBLIC;
