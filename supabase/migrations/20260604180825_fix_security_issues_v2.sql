/*
  # Fix security issues

  1. Function: get_user_conversation_ids
    - Recreate with explicit search_path = '' (already set, reinforcing)
    - Add internal check: only returns results when p_user_id = auth.uid()
      This prevents users from querying other users' conversation IDs via RPC
    - Revoke EXECUTE from anon (anonymous users have no conversations)
    - Keep EXECUTE for authenticated (needed for RLS policy evaluation)

  2. Conversations INSERT policy
    - Replace always-true policy with one that requires a created_by column
    - Add created_by column to conversations table
    - Policy checks auth.uid() = created_by

  3. Security notes
    - The function remains SECURITY DEFINER because it's used inside RLS policies
      on conversation_members (avoids infinite recursion)
    - The auth.uid() check inside the function prevents parameter abuse
*/

-- 1. Recreate function with auth.uid() enforcement
CREATE OR REPLACE FUNCTION public.get_user_conversation_ids(p_user_id uuid)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT conversation_id
  FROM public.conversation_members
  WHERE user_id = p_user_id
    AND p_user_id = auth.uid();
$$;

-- 2. Revoke EXECUTE from anon, keep for authenticated
REVOKE EXECUTE ON FUNCTION public.get_user_conversation_ids(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_user_conversation_ids(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.get_user_conversation_ids(uuid) TO authenticated;

-- 3. Add created_by column to conversations
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'conversations' AND column_name = 'created_by'
  ) THEN
    ALTER TABLE public.conversations ADD COLUMN created_by uuid DEFAULT auth.uid();
  END IF;
END $$;

-- 4. Replace the always-true INSERT policy with a restrictive one
DROP POLICY IF EXISTS "Authenticated users can create conversations" ON public.conversations;

CREATE POLICY "Users can create conversations as themselves"
  ON public.conversations FOR INSERT
  TO authenticated
  WITH CHECK (
    created_by = auth.uid()
  );
