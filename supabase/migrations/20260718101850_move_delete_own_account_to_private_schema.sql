/*
# Move delete_own_account to private schema

1. Security Fix
  - The `public.delete_own_account()` SECURITY DEFINER function is callable by anon and authenticated
    roles via PostgREST `/rest/v1/rpc/delete_own_account`, which is a security risk.
  - Move the actual SECURITY DEFINER logic to `private.delete_own_account_impl()` where PostgREST
    cannot expose it (PostgREST only exposes the `public` schema).
  - Replace `public.delete_own_account()` with a SECURITY INVOKER wrapper that simply calls the
    private implementation. SECURITY INVOKER means PostgREST runs it as the calling role,
    and the private function handles the elevated privileges internally.
  - Revoke EXECUTE on both functions from anon and public roles.
  - Grant EXECUTE only to authenticated on the public wrapper.
  - Grant EXECUTE only to authenticated on the private implementation.
*/

-- Step 1: Create the implementation in private schema
CREATE OR REPLACE FUNCTION private.delete_own_account_impl()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  DELETE FROM public.messages WHERE sender_id = _uid;
  DELETE FROM public.contacts WHERE user_id = _uid OR contact_id = _uid;
  DELETE FROM public.blocked_users WHERE user_id = _uid OR blocked_user_id = _uid;
  DELETE FROM public.conversation_members WHERE user_id = _uid;
  DELETE FROM public.push_tokens WHERE user_id = _uid;
  DELETE FROM public.message_reactions WHERE user_id = _uid;
  DELETE FROM public.starred_messages WHERE user_id = _uid;
  DELETE FROM public.saved_messages WHERE user_id = _uid;
  DELETE FROM public.drafts WHERE user_id = _uid;
  DELETE FROM public.user_statuses WHERE user_id = _uid;
  DELETE FROM public.close_friends WHERE user_id = _uid OR friend_id = _uid;
  DELETE FROM public.hidden_statuses WHERE user_id = _uid OR hidden_user_id = _uid;
  DELETE FROM public.status_reactions WHERE user_id = _uid;
  DELETE FROM public.call_participants WHERE user_id = _uid;
  DELETE FROM public.call_feedback WHERE user_id = _uid;
  DELETE FROM public.daily_reports WHERE user_id = _uid;
  DELETE FROM public.scheduled_messages WHERE user_id = _uid;
  DELETE FROM public.contact_join_notifications WHERE user_id = _uid OR joined_user_id = _uid;
  DELETE FROM public.notification_rate_limits WHERE user_id = _uid;
  DELETE FROM public.push_receipt_queue WHERE user_id = _uid;
  DELETE FROM public.reports WHERE reporter_id = _uid;

  UPDATE public.profiles SET
    display_name = 'Deleted User',
    avatar_url = NULL,
    phone = '',
    status_text = '',
    is_online = false,
    privacy_settings = NULL,
    security_settings = NULL,
    notification_settings = NULL,
    storage_settings = NULL
  WHERE id = _uid;

  DELETE FROM auth.users WHERE id = _uid;
END;
$$;

-- Step 2: Lock down the private implementation
REVOKE EXECUTE ON FUNCTION private.delete_own_account_impl() FROM public;
REVOKE EXECUTE ON FUNCTION private.delete_own_account_impl() FROM anon;
GRANT EXECUTE ON FUNCTION private.delete_own_account_impl() TO authenticated;

-- Step 3: Replace the public function with a SECURITY INVOKER wrapper
DROP FUNCTION IF EXISTS public.delete_own_account();

CREATE OR REPLACE FUNCTION public.delete_own_account()
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  PERFORM private.delete_own_account_impl();
END;
$$;

-- Step 4: Lock down the public wrapper
REVOKE EXECUTE ON FUNCTION public.delete_own_account() FROM public;
REVOKE EXECUTE ON FUNCTION public.delete_own_account() FROM anon;
GRANT EXECUTE ON FUNCTION public.delete_own_account() TO authenticated;
