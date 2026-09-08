/*
# Add conversation_type filter to search_messages function

1. Modified Functions
  - `search_messages` - Added optional `p_conversation_type` parameter
    - When provided, filters results to only messages from conversations of that type
    - Supports values: 'channel', 'group', 'direct'
    - NULL means no filtering (returns all types)

2. Important Notes
  - This is a backward-compatible change - existing calls without the new parameter continue to work
  - The function signature is extended with a new DEFAULT NULL parameter
  - Uses SET search_path = public to prevent search_path injection
*/

CREATE OR REPLACE FUNCTION search_messages(
  p_query text,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0,
  p_conversation_id uuid DEFAULT NULL,
  p_message_type text DEFAULT NULL,
  p_conversation_type text DEFAULT NULL
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
    AND (p_conversation_type IS NULL OR c.type = p_conversation_type)
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
