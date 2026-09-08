-- Trigger functions need EXECUTE permission for the calling role,
-- even when they are SECURITY DEFINER. Without this, any INSERT/UPDATE
-- that fires these triggers fails with "permission denied".

GRANT EXECUTE ON FUNCTION public.notify_incoming_call() TO authenticated;
GRANT EXECUTE ON FUNCTION public.notify_message_reaction() TO authenticated;
GRANT EXECUTE ON FUNCTION public.on_profile_display_name_set() TO authenticated;
GRANT EXECUTE ON FUNCTION public.notify_new_story() TO authenticated;