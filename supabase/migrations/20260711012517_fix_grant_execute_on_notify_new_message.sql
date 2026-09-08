-- The notify_new_message() trigger function fires on every message INSERT.
-- Even though it is SECURITY DEFINER, the calling role (authenticated) still
-- needs EXECUTE permission to invoke the trigger function.
-- Without this grant, all message inserts (including photo/video) fail silently.
GRANT EXECUTE ON FUNCTION public.notify_new_message() TO authenticated;