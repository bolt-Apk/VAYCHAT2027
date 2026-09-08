/*
# Revoke EXECUTE on notify_new_story from PUBLIC pseudo-role

Previous migrations revoked from `anon` and `authenticated` directly, but the
`PUBLIC` pseudo-role (which all roles inherit from) still had EXECUTE granted.
This migration revokes from `PUBLIC` to fully close the RPC exposure, then
re-grants only to `postgres` and `service_role` which need it for trigger execution.

1. Security Changes
   - Revoke EXECUTE on `public.notify_new_story()` from PUBLIC.
   - Re-grant to `postgres` and `service_role` only.
*/

REVOKE EXECUTE ON FUNCTION public.notify_new_story() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.notify_new_story() TO postgres, service_role;
