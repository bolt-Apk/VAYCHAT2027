-- Re-grant EXECUTE on can_view_status to authenticated.
-- The function is SECURITY DEFINER and used by RLS policies on user_statuses.
-- RLS policies execute in the caller's role context, so the calling role
-- must have EXECUTE permission on any functions referenced in the policy.
GRANT EXECUTE ON FUNCTION public.can_view_status(uuid, text, uuid) TO authenticated;