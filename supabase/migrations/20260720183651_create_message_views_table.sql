/*
# Create message_views table for channel post view statistics

1. New Tables
  - `message_views`
    - `id` (uuid, primary key)
    - `message_id` (uuid, FK messages, not null)
    - `user_id` (uuid, FK profiles, not null)
    - `viewed_at` (timestamptz, default now())
    - UNIQUE constraint on (message_id, user_id) to prevent duplicate views

2. New Function
  - `get_message_view_counts(p_message_ids uuid[])` returns table of
    (message_id uuid, view_count bigint) for batch querying view counts.

3. Indexes
  - Unique index on (message_id, user_id)
  - Index on message_id for fast count aggregation

4. Security (RLS)
  - RLS enabled on message_views.
  - SELECT: authenticated users can view counts for messages in their conversations.
  - INSERT: authenticated users can record their own views (user_id = auth.uid()).
  - UPDATE: not allowed (no policy).
  - DELETE: not allowed (no policy).

5. Realtime
  - Added to supabase_realtime publication for live view count updates.

6. Important notes
  - No destructive operations.
  - View counts are per-unique-user (same user viewing twice = 1 view).
  - Function uses SECURITY INVOKER so RLS applies.
*/

-- 1. Create the message_views table
CREATE TABLE IF NOT EXISTS public.message_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  viewed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT message_views_unique UNIQUE (message_id, user_id)
);

-- 2. Indexes
CREATE INDEX IF NOT EXISTS idx_message_views_message_id ON public.message_views (message_id);
CREATE INDEX IF NOT EXISTS idx_message_views_user_id ON public.message_views (user_id);

-- 3. Enable RLS
ALTER TABLE public.message_views ENABLE ROW LEVEL SECURITY;

-- 4. RLS Policies
DROP POLICY IF EXISTS "select_message_views" ON public.message_views;
CREATE POLICY "select_message_views" ON public.message_views
  FOR SELECT TO authenticated
  USING (
    message_id IN (
      SELECT m.id FROM public.messages m
      WHERE m.conversation_id IN (
        SELECT conversation_id FROM public.conversation_members WHERE user_id = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS "insert_own_views" ON public.message_views;
CREATE POLICY "insert_own_views" ON public.message_views
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- 5. Batch view count function
CREATE OR REPLACE FUNCTION public.get_message_view_counts(p_message_ids uuid[])
RETURNS TABLE(message_id uuid, view_count bigint)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT mv.message_id, count(*) AS view_count
  FROM public.message_views mv
  WHERE mv.message_id = ANY(p_message_ids)
  GROUP BY mv.message_id;
$$;

-- 6. Add to realtime publication
ALTER PUBLICATION supabase_realtime ADD TABLE public.message_views;
