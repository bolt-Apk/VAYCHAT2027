/*
# Create get_last_messages function

1. New Functions
  - `get_last_messages(p_conversation_ids uuid[])` 
    - Returns the most recent non-deleted message for each conversation ID provided
    - Uses DISTINCT ON for efficient single-pass retrieval
    - Returns: id, conversation_id, content, message_type, created_at, sender_id, is_read

2. Security
  - Function runs as invoker (SECURITY INVOKER) so RLS applies
  - EXECUTE granted to authenticated role only

3. Important Notes
  - This replaces the client-side approach of fetching N*3 messages and filtering
  - Uses PostgreSQL DISTINCT ON which is optimal for "latest per group" queries
*/

CREATE OR REPLACE FUNCTION get_last_messages(p_conversation_ids uuid[])
RETURNS TABLE(
  id uuid,
  conversation_id uuid,
  content text,
  message_type text,
  created_at timestamptz,
  sender_id uuid,
  is_read boolean
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT DISTINCT ON (m.conversation_id)
    m.id,
    m.conversation_id,
    m.content,
    m.message_type,
    m.created_at,
    m.sender_id,
    m.is_read
  FROM messages m
  WHERE m.conversation_id = ANY(p_conversation_ids)
    AND m.deleted_at IS NULL
  ORDER BY m.conversation_id, m.created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION get_last_messages(uuid[]) TO authenticated;
REVOKE EXECUTE ON FUNCTION get_last_messages(uuid[]) FROM anon;
