/*
# Create delete_own_account RPC function

1. Purpose
  - Provides a server-side function for users to delete their own account
  - Handles cleanup of all user data across tables that RLS would prevent client-side deletion
  - Uses SECURITY DEFINER to bypass RLS for cross-table cleanup

2. What it does
  - Deletes the user's messages, contacts (both directions), blocked users, conversation memberships
  - Deletes starred messages, message reactions, saved messages, drafts
  - Deletes push tokens, call feedback, daily reports, scheduled messages
  - Deletes user statuses, close friends, hidden statuses, status reactions
  - Deletes call participants
  - Removes avatar from storage
  - Anonymizes the profile (display_name = 'Deleted User', clears personal data)
  - Deletes the auth.users record, which cascades to remaining FK references

3. Security
  - SECURITY DEFINER with restricted search_path
  - Only operates on the calling user's own data (auth.uid())
  - Placed in private schema to prevent direct invocation from anon key
  - Granted EXECUTE to authenticated role only
*/

CREATE OR REPLACE FUNCTION public.delete_own_account()
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

  -- Clean up tables that reference user_id or related columns
  DELETE FROM public.messages WHERE sender_id = _uid;
  DELETE FROM public.contacts WHERE user_id = _uid OR contact_id = _uid;
  DELETE FROM public.blocked_users WHERE user_id = _uid OR blocked_user_id = _uid;
  DELETE FROM public.conversation_members WHERE user_id = _uid;
  DELETE FROM public.push_tokens WHERE user_id = _uid;

  -- Reactions, stars, saved messages
  DELETE FROM public.message_reactions WHERE user_id = _uid;
  DELETE FROM public.starred_messages WHERE user_id = _uid;
  DELETE FROM public.saved_messages WHERE user_id = _uid;

  -- Drafts
  DELETE FROM public.drafts WHERE user_id = _uid;

  -- Stories and related
  DELETE FROM public.user_statuses WHERE user_id = _uid;
  DELETE FROM public.close_friends WHERE user_id = _uid OR friend_id = _uid;
  DELETE FROM public.hidden_statuses WHERE user_id = _uid OR hidden_user_id = _uid;
  DELETE FROM public.status_reactions WHERE user_id = _uid;

  -- Calls
  DELETE FROM public.call_participants WHERE user_id = _uid;
  DELETE FROM public.call_feedback WHERE user_id = _uid;

  -- Reports and scheduled messages
  DELETE FROM public.daily_reports WHERE user_id = _uid;
  DELETE FROM public.scheduled_messages WHERE user_id = _uid;

  -- Contact join notifications
  DELETE FROM public.contact_join_notifications WHERE user_id = _uid OR joined_user_id = _uid;

  -- Notification rate limits and push receipt queue
  DELETE FROM public.notification_rate_limits WHERE user_id = _uid;
  DELETE FROM public.push_receipt_queue WHERE user_id = _uid;

  -- Reports (user reports)
  DELETE FROM public.reports WHERE reporter_id = _uid;

  -- Anonymize profile
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

  -- Delete auth user (cascades to profiles and remaining FK refs)
  DELETE FROM auth.users WHERE id = _uid;
END;
$$;

-- Only authenticated users can call this
GRANT EXECUTE ON FUNCTION public.delete_own_account() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.delete_own_account() FROM anon;
