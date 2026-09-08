/*
# Revoke public EXECUTE on can_view_status function

## Problem
The `can_view_status` SECURITY DEFINER function is callable by authenticated users
via `/rest/v1/rpc/can_view_status`, which is not intended. It is a helper used
only internally by RLS policies on user_statuses.

## Security Changes
- Revoke EXECUTE from `public`, `anon`, and `authenticated` roles.
- The function remains usable by RLS policies because policies run as the
  table owner, not the calling role.

## Important Notes
1. This is idempotent -- revoking an already-revoked grant is a no-op.
2. No data or schema changes, only permission tightening.
*/

REVOKE EXECUTE ON FUNCTION public.can_view_status(uuid, text, uuid) FROM public;
REVOKE EXECUTE ON FUNCTION public.can_view_status(uuid, text, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.can_view_status(uuid, text, uuid) FROM authenticated;
