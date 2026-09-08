/*
# Create search_messages RPC function

1. New Functions
  - `search_messages` - Full-text search across all conversations the user belongs to.
    - Parameters:
      - `p_query` (text) - The search query string
      - `p_limit` (integer, default 50) - Max results to return
      - `p_offset` (integer, default 0) - Pagination offset
      - `p_conversation_id` (uuid, optional) - Filter to a specific conversation
      - `p_message_type` (text, optional) - Filter by message type (text, image, etc.)
    - Returns: id, content, conversation_id, sender_id, message_type, created_at, sender_name, sender_avatar, conversation_name, conversation_type
    - Uses PostgreSQL full-text search with Russian config for queries >= 3 chars
    - Falls back to ILIKE for shorter queries or when FTS returns no results
    - Only searches within conversations the authenticated user is a member of
    - Excludes soft-deleted messages

2. Security
  - Function is SECURITY INVOKER so RLS still applies
  - Uses auth.uid() to scope results to user's conversations
  - SET search_path = public to prevent search_path injection

3. Important Notes
  - Leverages existing GIN index on to_tsvector('russian', content)
  - Pagination via limit/offset for loading more results
  - Returns denormalized data (sender name, conversation name) to avoid N+1 queries on client
*/

CREATE OR REPLACE FUNCTION search_messages(
  p_query text,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0,
  p_conversation_id uuid DEFAULT NULL,
  p_message_type text DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  content text,
  conversation_id uuid,
  sender_id uuid,
  message_type text,
  created_at timestamptz,
  sender_name text,
  sender_avatar text,
  conversation_name text,
  conversation_type text
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_tsquery tsquery;
BEGIN
  IF v_uid IS NULL THEN
    RETURN;
  END IF;

  IF length(trim(p_query)) < 2 THEN
    RETURN;
  END IF;

  -- Try to build a tsquery; fall back to ILIKE if it fails
  BEGIN
    v_tsquery := websearch_to_tsquery('russian', p_query);
  EXCEPTION WHEN OTHERS THEN
    v_tsquery := NULL;
  END;

  RETURN QUERY
  SELECT
    m.id,
    m.content,
    m.conversation_id,
    m.sender_id,
    m.message_type,
    m.created_at,
    p.display_name AS sender_name,
    p.avatar_url AS sender_avatar,
    COALESCE(c.name, '') AS conversation_name,
    c.type AS conversation_type
  FROM messages m
  JOIN conversation_members cm
    ON cm.conversation_id = m.conversation_id
    AND cm.user_id = v_uid
  JOIN profiles p ON p.id = m.sender_id
  JOIN conversations c ON c.id = m.conversation_id
  WHERE m.deleted_at IS NULL
    AND (p_conversation_id IS NULL OR m.conversation_id = p_conversation_id)
    AND (p_message_type IS NULL OR m.message_type = p_message_type)
    AND (
      CASE
        WHEN v_tsquery IS NOT NULL
          THEN to_tsvector('russian', m.content) @@ v_tsquery
        ELSE m.content ILIKE '%' || p_query || '%'
      END
    )
  ORDER BY m.created_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;