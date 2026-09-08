
-- =============================================================
-- Fix security advisor findings
-- =============================================================
-- 1. Public bucket listing: drop broad SELECT policies on storage.objects
--    for avatars, chat-media, stories-media. Public buckets serve objects
--    via public URLs without SELECT policies; these only enabled listing.
-- 2. SECURITY DEFINER function exposure: public.get_user_conversation_ids
--    was callable via /rest/v1/rpc by anon + authenticated, leaking any
--    user's conversation IDs. Move all RLS policy references to the
--    private schema copy (not exposed by PostgREST) and drop the public
--    copy.
-- =============================================================

-- 1. Drop broad SELECT listing policies on public storage buckets.
DROP POLICY IF EXISTS "Public can view avatars" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can view chat media" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can view stories media" ON storage.objects;

-- 2. Remove public.get_user_conversation_ids RPC exposure.
-- Grant USAGE on private schema so RLS policies can resolve function names.
-- PostgREST does not expose the private schema via RPC, so this is safe.
GRANT USAGE ON SCHEMA private TO authenticated, anon;

-- Ensure EXECUTE on the two functions used by RLS policies.
GRANT EXECUTE ON FUNCTION private.get_user_conversation_ids(uuid) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION private.can_view_status(uuid, text, uuid) TO authenticated, anon;

-- Revoke EXECUTE on all other private functions from client roles.
-- These are internal functions (triggers, cron, notification helpers)
-- that run with owner privileges and don't need client EXECUTE grants.
REVOKE EXECUTE ON FUNCTION private.check_push_receipts_cron() FROM authenticated, anon, public;
REVOKE EXECUTE ON FUNCTION private.cleanup_expired_statuses() FROM authenticated, anon, public;
REVOKE EXECUTE ON FUNCTION private.cleanup_orphaned_media(integer) FROM authenticated, anon, public;
REVOKE EXECUTE ON FUNCTION private.delete_own_account_impl() FROM authenticated, anon, public;
REVOKE EXECUTE ON FUNCTION private.delete_storage_object(text, text) FROM authenticated, anon, public;
REVOKE EXECUTE ON FUNCTION private.get_push_secret() FROM authenticated, anon, public;
REVOKE EXECUTE ON FUNCTION private.is_in_quiet_hours(uuid) FROM authenticated, anon, public;
REVOKE EXECUTE ON FUNCTION private.notify_contact_joined() FROM authenticated, anon, public;
REVOKE EXECUTE ON FUNCTION private.notify_incoming_call() FROM authenticated, anon, public;
REVOKE EXECUTE ON FUNCTION private.notify_message_reaction() FROM authenticated, anon, public;
REVOKE EXECUTE ON FUNCTION private.notify_new_message() FROM authenticated, anon, public;
REVOKE EXECUTE ON FUNCTION private.notify_new_story() FROM authenticated, anon, public;
REVOKE EXECUTE ON FUNCTION private.on_profile_display_name_set() FROM authenticated, anon, public;
REVOKE EXECUTE ON FUNCTION private.process_scheduled_messages() FROM authenticated, anon, public;
REVOKE EXECUTE ON FUNCTION private.set_push_token_updated_at() FROM authenticated, anon, public;
REVOKE EXECUTE ON FUNCTION private.update_conversation_timestamp() FROM authenticated, anon, public;

-- Recreate policies that called unqualified get_user_conversation_ids
-- (resolving to the public schema copy) to use private.get_user_conversation_ids.
DROP POLICY IF EXISTS "Members can view their conversations" ON conversations;
CREATE POLICY "Members can view their conversations" ON conversations
  FOR SELECT TO authenticated
  USING (id IN (SELECT private.get_user_conversation_ids(auth.uid())));

DROP POLICY IF EXISTS "Admins can update conversations" ON conversations;
CREATE POLICY "Admins can update conversations" ON conversations
  FOR UPDATE TO authenticated
  USING (id IN (SELECT private.get_user_conversation_ids(auth.uid())))
  WITH CHECK (id IN (SELECT private.get_user_conversation_ids(auth.uid())));

DROP POLICY IF EXISTS "Members can send messages to their conversations" ON messages;
CREATE POLICY "Members can send messages to their conversations" ON messages
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = sender_id AND conversation_id IN (SELECT private.get_user_conversation_ids(auth.uid())));

DROP POLICY IF EXISTS "Members can view conversation messages" ON messages;
CREATE POLICY "Members can view conversation messages" ON messages
  FOR SELECT TO authenticated
  USING (conversation_id IN (SELECT private.get_user_conversation_ids(auth.uid())));

DROP POLICY IF EXISTS "Members can mark messages as read" ON messages;
CREATE POLICY "Members can mark messages as read" ON messages
  FOR UPDATE TO authenticated
  USING (conversation_id IN (SELECT private.get_user_conversation_ids(auth.uid())))
  WITH CHECK (conversation_id IN (SELECT private.get_user_conversation_ids(auth.uid())));

-- Drop the public copy to remove the /rest/v1/rpc/get_user_conversation_ids endpoint.
DROP FUNCTION IF EXISTS public.get_user_conversation_ids(uuid);
