/*
# Revoke EXECUTE on notify_new_story from public roles

Security fix: the `notify_new_story()` SECURITY DEFINER function was callable
by `anon` and `authenticated` roles via the REST API `/rpc/notify_new_story`.
This function is only meant to run as a database trigger, not via direct RPC.

1. Security Changes
   - Revoke EXECUTE on `public.notify_new_story()` from `anon` and `authenticated`.
*/

REVOKE EXECUTE ON FUNCTION public.notify_new_story() FROM anon, authenticated;
