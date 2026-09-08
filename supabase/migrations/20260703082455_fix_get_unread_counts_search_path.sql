/*
# Fix mutable search_path on get_unread_counts function

## Problem
The `public.get_unread_counts` function has a role-mutable search_path,
which is a security risk — a malicious role could prepend a schema to
the search_path and shadow the `messages` or `conversation_members` tables.

## Changes
- Recreate the function with `SET search_path = public` to pin it.

## Security
- Pinning search_path prevents search_path injection attacks.
*/

CREATE OR REPLACE FUNCTION get_unread_counts(
  p_user_id uuid,
  p_conversation_ids uuid[]
)
RETURNS TABLE(conversation_id uuid, cnt bigint)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT m.conversation_id, count(*) AS cnt
  FROM messages m
  JOIN conversation_members cm
    ON cm.conversation_id = m.conversation_id
    AND cm.user_id = p_user_id
  WHERE m.conversation_id = ANY(p_conversation_ids)
    AND m.sender_id <> p_user_id
    AND m.deleted_at IS NULL
    AND (cm.last_read_at IS NULL OR m.created_at > cm.last_read_at)
  GROUP BY m.conversation_id;
$$;