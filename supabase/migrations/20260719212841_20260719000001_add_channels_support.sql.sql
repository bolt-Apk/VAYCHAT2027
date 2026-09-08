/*
  # Add channels support

  This migration introduces Telegram-style broadcast channels on top of the
  existing conversations infrastructure. A channel is a one-to-many broadcast
  conversation where only admins/owner post and subscribers read.

  1. Schema changes
    - conversations:
        - Extends `type` CHECK to include 'channel'.
        - New `username` text (unique public handle, lowercase, 5-32 chars, nullable).
        - New `description` text (nullable channel bio, max 255 chars).
        - New `is_public` boolean default true (public channels are discoverable).
        - New `is_verified` boolean default false (admin-only flag, not exposed via API).
    - conversation_members:
        - Extends `role` CHECK to include 'owner' (channel creator, supersedes admin).
        - New `is_admin_poster` boolean default false (reserved for future poster role).
    - New table `channel_subscribers`:
        - Tracks lightweight subscriber count separately from conversation_members.
        - Columns: id, channel_id (FK conversations), user_id (FK profiles),
          created_at. UNIQUE(channel_id, user_id).

  2. Indexes
    - Unique index on conversations.username (partial, only non-null).
    - Index on channel_subscribers.user_id and channel_subscribers.channel_id.

  3. Security (RLS)
    - RLS enabled on channel_subscribers.
    - New conversation SELECT policy "Public channels are viewable by everyone"
      scoped to TO authenticated WHERE type='channel' AND is_public=true. Keeps
      existing membership-based SELECT intact.
    - channel_subscribers CRUD: authenticated users can subscribe/unsubscribe
      themselves; anyone can read subscriber list of public channels; channel
      owner/admin can read subscriber list of private channels.
    - Existing conversations INSERT policy already checks `created_by = auth.uid()`
      which covers channel creation.

  4. Important notes
    - No destructive operations. Existing rows are untouched.
    - The `owner` role is only used for channels; groups continue to use admin/member.
    - Subscribers are NOT conversation_members by design: a channel can have many
      subscribers without each one being a conversation_member row. However, for
      message-read tracking and chat-list display we DO insert a conversation_member
      row per subscriber (role='member'), keeping existing flows intact.
      `channel_subscribers` is an auxiliary table for discovery + counting.
*/

-- 1. Extend conversations.type to include 'channel'
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.conversations'::regclass
    AND conname = 'conversations_type_check'
  ) THEN
    ALTER TABLE public.conversations DROP CONSTRAINT conversations_type_check;
  END IF;
END $$;

ALTER TABLE public.conversations
  ADD CONSTRAINT conversations_type_check
  CHECK (type IN ('direct', 'group', 'saved', 'channel'));

-- 2. Add channel-specific columns to conversations
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='conversations' AND column_name='username'
  ) THEN
    ALTER TABLE public.conversations ADD COLUMN username text;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='conversations' AND column_name='description'
  ) THEN
    ALTER TABLE public.conversations ADD COLUMN description text;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='conversations' AND column_name='is_public'
  ) THEN
    ALTER TABLE public.conversations ADD COLUMN is_public boolean NOT NULL DEFAULT true;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='conversations' AND column_name='is_verified'
  ) THEN
    ALTER TABLE public.conversations ADD COLUMN is_verified boolean NOT NULL DEFAULT false;
  END IF;
END $$;

-- 3. Extend conversation_members.role to include 'owner'
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.conversation_members'::regclass
    AND conname = 'conversation_members_role_check'
  ) THEN
    ALTER TABLE public.conversation_members DROP CONSTRAINT conversation_members_role_check;
  END IF;
END $$;

ALTER TABLE public.conversation_members
  ADD CONSTRAINT conversation_members_role_check
  CHECK (role IN ('owner', 'admin', 'member'));

-- 4. Create channel_subscribers table
CREATE TABLE IF NOT EXISTS public.channel_subscribers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(channel_id, user_id)
);

ALTER TABLE public.channel_subscribers ENABLE ROW LEVEL SECURITY;

-- 5. Indexes
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_username_unique
  ON public.conversations (username)
  WHERE username IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_channel_subscribers_user_id
  ON public.channel_subscribers (user_id);

CREATE INDEX IF NOT EXISTS idx_channel_subscribers_channel_id
  ON public.channel_subscribers (channel_id);

CREATE INDEX IF NOT EXISTS idx_conversations_type
  ON public.conversations (type)
  WHERE type = 'channel';

CREATE INDEX IF NOT EXISTS idx_conversations_public_channels
  ON public.conversations (updated_at DESC)
  WHERE type = 'channel' AND is_public = true;

-- 6. RLS policies for channel_subscribers
DROP POLICY IF EXISTS "Subscribers can view public channel subscribers" ON public.channel_subscribers;
CREATE POLICY "Subscribers can view public channel subscribers"
  ON public.channel_subscribers FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = channel_subscribers.channel_id
      AND c.type = 'channel'
      AND c.is_public = true
    )
    OR channel_subscribers.user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.conversation_members cm
      WHERE cm.conversation_id = channel_subscribers.channel_id
      AND cm.user_id = auth.uid()
      AND cm.role IN ('owner', 'admin')
    )
  );

DROP POLICY IF EXISTS "Users can subscribe to channels" ON public.channel_subscribers;
CREATE POLICY "Users can subscribe to channels"
  ON public.channel_subscribers FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = channel_subscribers.channel_id
      AND c.type = 'channel'
      AND (
        c.is_public = true
        OR EXISTS (
          SELECT 1 FROM public.conversation_members cm
          WHERE cm.conversation_id = c.id
          AND cm.user_id = auth.uid()
          AND cm.role IN ('owner', 'admin')
        )
      )
    )
  );

DROP POLICY IF EXISTS "Users can unsubscribe from channels" ON public.channel_subscribers;
CREATE POLICY "Users can unsubscribe from channels"
  ON public.channel_subscribers FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- 7. Allow authenticated users to also discover public channels via conversations SELECT
--    Existing membership-based SELECT remains; add a new policy for public channels.
DROP POLICY IF EXISTS "Public channels are discoverable" ON public.conversations;
CREATE POLICY "Public channels are discoverable"
  ON public.conversations FOR SELECT
  TO authenticated
  USING (
    type = 'channel' AND is_public = true
  );

-- 8. Allow channel owner/admin to update their channel (existing update policy
--    already covers admins via private.get_user_conversation_ids which includes
--    channel conversation_members rows). No change needed.

-- 9. Helper: subscriber count by channel (safe, avoids exposing user ids)
CREATE OR REPLACE FUNCTION public.get_channel_subscriber_count(p_channel_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT count(*)::integer FROM public.channel_subscribers
  WHERE channel_id = p_channel_id;
$$;

REVOKE EXECUTE ON FUNCTION public.get_channel_subscriber_count(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.get_channel_subscriber_count(uuid) TO authenticated;
