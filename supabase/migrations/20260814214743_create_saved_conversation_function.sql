/*
# Create atomic get-or-create saved conversation function

## Problem
Creating a "saved messages" (favorites) conversation requires inserting into
conversations then conversation_members. The RLS SELECT policy on conversations
requires membership, creating a chicken-and-egg problem identical to the direct
conversation issue. The member insert fails silently, creating orphaned saved conversations.

## Solution
A SECURITY DEFINER function that:
1. Checks for an existing saved conversation owned by the caller
2. If none exists, atomically creates the conversation + member
3. Returns the conversation ID

## Security
- SECURITY DEFINER with auth.uid() validation
- Only creates saved conversations for the calling user (no cross-user access)
- EXECUTE granted only to authenticated role
*/

CREATE OR REPLACE FUNCTION public.get_or_create_saved_conversation()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_conv_id uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Check for existing saved conversation
  SELECT c.id INTO v_conv_id
  FROM conversations c
  JOIN conversation_members cm ON cm.conversation_id = c.id
  WHERE cm.user_id = v_user_id
    AND c.type = 'saved'
  LIMIT 1;

  IF v_conv_id IS NOT NULL THEN
    RETURN v_conv_id;
  END IF;

  -- Create atomically
  v_conv_id := gen_random_uuid();

  INSERT INTO conversations (id, type, name, created_by)
  VALUES (v_conv_id, 'saved', 'Избранное', v_user_id);

  INSERT INTO conversation_members (conversation_id, user_id, role)
  VALUES (v_conv_id, v_user_id, 'admin');

  RETURN v_conv_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_or_create_saved_conversation() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_or_create_saved_conversation() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_or_create_saved_conversation() TO authenticated;
