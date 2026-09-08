/*
# Create get_unread_counts function for batched unread count queries

## Problem
The chat list screen was making N separate queries (one per conversation)
to count unread messages. This caused severe latency with many conversations.

## Solution
A single SQL function that returns unread counts for multiple conversations
at once, using the conversation_members.last_read_at timestamp.

## New function
- `get_unread_counts(p_user_id uuid, p_conversation_ids uuid[])` - returns
  table of (conversation_id, cnt) for unread messages across all specified
  conversations in a single query.

## Security
- SECURITY INVOKER (runs as calling user, respects RLS)
- Only counts messages not sent by the requesting user
- Only counts messages after the user's last_read_at for each conversation
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
