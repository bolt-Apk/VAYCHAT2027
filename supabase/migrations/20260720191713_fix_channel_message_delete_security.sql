/*
# Fix channel message deletion security vulnerability

A subscriber could soft-delete (set deleted_at on) any message in a channel
because the "Members can mark messages as read" UPDATE policy allowed ANY
conversation member to update ANY field on ANY message in their conversations.

## Changes

1. Replace "Members can mark messages as read" policy with a restricted version
   that only allows updates when deleted_at is NOT being set (i.e., legitimate
   read-marking operations).

2. Add a new policy "Channel admins can soft-delete messages" that allows
   channel admins/owners to set deleted_at on messages in their channels.

3. The existing "Senders can update own messages" policy remains unchanged --
   message authors can still edit/delete their own messages.

## Security
- Non-admin channel subscribers can no longer soft-delete channel posts.
- Channel admins/owners retain the ability to moderate (delete any post).
- Message senders can still delete their own messages via the sender policy.
- The read-marking policy still works for its intended purpose.
*/

-- 1. Drop the overly permissive policy
DROP POLICY IF EXISTS "Members can mark messages as read" ON public.messages;

-- 2. Create a restricted version that prevents setting deleted_at
CREATE POLICY "Members can mark messages as read" ON public.messages
  FOR UPDATE TO authenticated
  USING (
    conversation_id IN (SELECT private.get_user_conversation_ids(auth.uid()))
  )
  WITH CHECK (
    conversation_id IN (SELECT private.get_user_conversation_ids(auth.uid()))
    AND deleted_at IS NULL
  );

-- 3. Add policy for channel admins to soft-delete messages
DROP POLICY IF EXISTS "Channel admins can delete messages" ON public.messages;
CREATE POLICY "Channel admins can delete messages" ON public.messages
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = messages.conversation_id
        AND c.type = 'channel'
    )
    AND EXISTS (
      SELECT 1 FROM public.conversation_members cm
      WHERE cm.conversation_id = messages.conversation_id
        AND cm.user_id = auth.uid()
        AND cm.role IN ('owner', 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = messages.conversation_id
        AND c.type = 'channel'
    )
    AND EXISTS (
      SELECT 1 FROM public.conversation_members cm
      WHERE cm.conversation_id = messages.conversation_id
        AND cm.user_id = auth.uid()
        AND cm.role IN ('owner', 'admin')
    )
  );
