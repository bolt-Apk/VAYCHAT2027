/*
# Revoke public execute on notify_new_story

## Security fix
- `notify_new_story()` is a SECURITY DEFINER trigger function meant to be invoked only
  by the database trigger on `user_statuses` INSERT, not by end users via the REST API.
- Revokes EXECUTE from `anon` and `authenticated` roles so it cannot be called
  via `/rest/v1/rpc/notify_new_story`.
*/

REVOKE EXECUTE ON FUNCTION public.notify_new_story() FROM anon, authenticated;
