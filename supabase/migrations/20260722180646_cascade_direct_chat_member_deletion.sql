/*
# Cascade direct chat member deletion

When one participant in a direct (1-on-1) conversation deletes their membership,
automatically delete the other participant's membership too, so the chat disappears
for both users. This only applies to conversations with type = 'direct'.

1. New Functions
   - `private.cascade_direct_chat_member_delete()` — trigger function that finds
     the conversation type and, if direct, deletes the remaining member row.

2. New Triggers
   - `trigger_cascade_direct_member_delete` on `conversation_members` AFTER DELETE

3. Security
   - Function is SECURITY DEFINER in the `private` schema to bypass RLS.
   - EXECUTE is NOT granted to public/anon/authenticated — only callable by the trigger.
*/

CREATE OR REPLACE FUNCTION private.cascade_direct_chat_member_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  conv_type text;
BEGIN
  SELECT type INTO conv_type
  FROM public.conversations
  WHERE id = OLD.conversation_id;

  IF conv_type = 'direct' THEN
    DELETE FROM public.conversation_members
    WHERE conversation_id = OLD.conversation_id
      AND user_id != OLD.user_id;
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trigger_cascade_direct_member_delete ON public.conversation_members;
CREATE TRIGGER trigger_cascade_direct_member_delete
  AFTER DELETE ON public.conversation_members
  FOR EACH ROW
  EXECUTE FUNCTION private.cascade_direct_chat_member_delete();
