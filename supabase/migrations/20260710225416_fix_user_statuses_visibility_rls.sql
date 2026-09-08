/*
# Fix user_statuses SELECT policy to respect visibility settings

## Problem
The existing `select_statuses` policy uses `USING (true)` which allows ALL authenticated
users to see ALL stories, completely ignoring the `visibility` column added in a later
migration. Stories marked as 'nobody', 'contacts', or 'close_friends' are visible to everyone.

## Changes
1. Create a SECURITY DEFINER helper function `can_view_status` that checks visibility
   without triggering recursive RLS on contacts/close_friends tables.
2. Drop and replace the `select_statuses` policy on `user_statuses` with a visibility-aware policy.

## Visibility rules
- `everyone`: visible to all authenticated users (same as before)
- `contacts`: visible only to mutual contacts (both users added each other to contacts)
- `close_friends`: visible only to users in the story owner's close_friends list
- `nobody`: visible only to the story owner themselves
- Owner always sees their own stories regardless of visibility setting

## Security
- Function is SECURITY DEFINER to bypass RLS on contacts/close_friends lookups
- search_path set to public to prevent search_path injection
- EXECUTE revoked from public, granted only to authenticated
*/

CREATE OR REPLACE FUNCTION public.can_view_status(
  p_status_user_id uuid,
  p_status_visibility text,
  p_viewer_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_viewer_id = p_status_user_id THEN
    RETURN true;
  END IF;

  IF p_status_visibility = 'nobody' THEN
    RETURN false;
  END IF;

  IF p_status_visibility = 'everyone' THEN
    RETURN true;
  END IF;

  IF p_status_visibility = 'contacts' THEN
    RETURN EXISTS (
      SELECT 1 FROM contacts
      WHERE user_id = p_status_user_id AND contact_id = p_viewer_id
    ) AND EXISTS (
      SELECT 1 FROM contacts
      WHERE user_id = p_viewer_id AND contact_id = p_status_user_id
    );
  END IF;

  IF p_status_visibility = 'close_friends' THEN
    RETURN EXISTS (
      SELECT 1 FROM close_friends
      WHERE user_id = p_status_user_id AND friend_id = p_viewer_id
    );
  END IF;

  RETURN false;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.can_view_status(uuid, text, uuid) FROM public;
REVOKE EXECUTE ON FUNCTION public.can_view_status(uuid, text, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.can_view_status(uuid, text, uuid) TO authenticated;

DROP POLICY IF EXISTS "select_statuses" ON user_statuses;
CREATE POLICY "select_statuses" ON user_statuses FOR SELECT
  TO authenticated
  USING (
    public.can_view_status(user_id, visibility, auth.uid())
  );
