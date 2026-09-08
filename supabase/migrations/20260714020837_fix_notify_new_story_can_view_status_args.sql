/*
# Fix notify_new_story trigger — wrong number of arguments to can_view_status

## Problem
The `private.notify_new_story()` trigger function calls
`private.can_view_status(c.user_id, NEW.user_id, NEW.visibility, NEW.id)` with 4 arguments,
but the function signature is `can_view_status(p_status_user_id uuid, p_status_visibility text, p_viewer_id uuid)` — only 3.

This causes every INSERT into `user_statuses` to fail with:
  "function private.can_view_status(uuid, uuid, text, uuid) does not exist"

Meaning stories/statuses cannot be published at all.

## Fix
Correct the call to `private.can_view_status(NEW.user_id, NEW.visibility, c.user_id)`:
  - arg 1: status author  = NEW.user_id
  - arg 2: visibility     = NEW.visibility
  - arg 3: viewer         = c.user_id

## Modified Functions
- `private.notify_new_story()` — corrected `can_view_status` call from 4 args to 3
*/

CREATE OR REPLACE FUNCTION private.notify_new_story()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_author_name text;
  v_body text;
  v_user_ids uuid[];
  v_secret text;
BEGIN
  SELECT display_name INTO v_author_name
  FROM public.profiles WHERE id = NEW.user_id;

  IF v_author_name IS NULL OR v_author_name = '' THEN
    v_author_name := 'Пользователь';
  END IF;

  IF NEW.media_type = 'voice' THEN
    v_body := 'Новый голосовой статус';
  ELSIF NEW.media_type = 'video' THEN
    v_body := 'Новый видео-статус';
  ELSE
    v_body := 'Новый статус';
  END IF;

  IF NEW.content IS NOT NULL AND NEW.content != '' THEN
    v_body := LEFT(NEW.content, 200);
  END IF;

  SELECT array_agg(DISTINCT c.user_id) INTO v_user_ids
  FROM public.conversation_members c
  JOIN public.conversations conv ON conv.id = c.conversation_id
  WHERE conv.type = 'direct'
    AND c.user_id != NEW.user_id
    AND EXISTS (
      SELECT 1 FROM public.conversation_members cm
      WHERE cm.conversation_id = c.conversation_id AND cm.user_id = NEW.user_id
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.hidden_statuses hs
      WHERE hs.user_id = c.user_id AND hs.hidden_user_id = NEW.user_id
    )
    AND private.can_view_status(NEW.user_id, NEW.visibility, c.user_id);

  IF v_user_ids IS NULL OR array_length(v_user_ids, 1) IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT array_agg(p.id) INTO v_user_ids
  FROM public.profiles p
  WHERE p.id = ANY(v_user_ids)
    AND (p.notification_settings IS NULL OR (p.notification_settings->>'stories')::boolean != false);

  IF v_user_ids IS NULL OR array_length(v_user_ids, 1) IS NULL THEN
    RETURN NEW;
  END IF;

  v_secret := private.get_push_secret();

  PERFORM net.http_post(
    url := 'https://wdvgbdgklbrileuyweqs.supabase.co/functions/v1/send-push-notification',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_secret
    ),
    body := jsonb_build_object(
      'user_ids', to_jsonb(v_user_ids),
      'title', v_author_name,
      'body', v_body,
      'data', jsonb_build_object(
        'status_id', NEW.id,
        'author_id', NEW.user_id,
        'type', 'story'
      ),
      'categoryId', 'story'
    )
  );

  RETURN NEW;
END;
$function$;
