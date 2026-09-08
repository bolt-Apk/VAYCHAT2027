/*
  # Allow conversation members to mark messages as read

  Users need to mark messages from others as read (is_read = true).
  Add a policy that allows updating is_read for messages in user's conversations.
*/

CREATE POLICY "Members can mark messages as read"
  ON public.messages FOR UPDATE
  TO authenticated
  USING (
    conversation_id IN (SELECT get_user_conversation_ids(auth.uid()))
  )
  WITH CHECK (
    conversation_id IN (SELECT get_user_conversation_ids(auth.uid()))
  );
