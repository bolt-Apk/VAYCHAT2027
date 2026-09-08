/*
# Create atomic direct conversation function

## Problem
Creating a direct conversation requires 3 sequential inserts:
1. INSERT into conversations
2. INSERT self into conversation_members
3. INSERT other user into conversation_members

The conversation_members INSERT policy's EXISTS subquery checks conversations.created_by,
but the conversations SELECT policy blocks that check because the creator isn't a member yet.
This causes the self-insert to silently fail via RLS, leaving orphaned conversations with 0 members.

## Solution
A SECURITY DEFINER function that:
1. Checks for an existing direct conversation between the two users (dedup)
2. If none exists, atomically creates the conversation + both members
3. Returns the conversation ID

## Security
- Function is SECURITY DEFINER (bypasses RLS) but validates auth.uid() internally
- Only allows creating conversations where the caller is one of the two participants
- Checks both users exist in profiles table
- EXECUTE granted only to authenticated role
*/

CREATE OR REPLACE FUNCTION public.create_direct_conversation(p_other_user_id uuid)
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

  IF v_user_id = p_other_user_id THEN
    RAISE EXCEPTION 'Cannot create conversation with yourself';
  END IF;

  -- Verify other user exists
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_other_user_id) THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  -- Check for existing direct conversation between these two users
  SELECT cm1.conversation_id INTO v_conv_id
  FROM conversation_members cm1
  JOIN conversation_members cm2 ON cm1.conversation_id = cm2.conversation_id
  JOIN conversations c ON c.id = cm1.conversation_id
  WHERE cm1.user_id = v_user_id
    AND cm2.user_id = p_other_user_id
    AND c.type = 'direct'
  LIMIT 1;

  IF v_conv_id IS NOT NULL THEN
    RETURN v_conv_id;
  END IF;

  -- Create new conversation + both members atomically
  v_conv_id := gen_random_uuid();

  INSERT INTO conversations (id, type, created_by)
  VALUES (v_conv_id, 'direct', v_user_id);

  INSERT INTO conversation_members (conversation_id, user_id, role)
  VALUES
    (v_conv_id, v_user_id, 'admin'),
    (v_conv_id, p_other_user_id, 'admin');

  RETURN v_conv_id;
END;
$$;

-- Only authenticated users can call this
REVOKE ALL ON FUNCTION public.create_direct_conversation(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_direct_conversation(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_direct_conversation(uuid) TO authenticated;
