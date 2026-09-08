/*
# Move SECURITY DEFINER functions from public to private schema

## Problem
Six SECURITY DEFINER functions in the `public` schema are exposed via PostgREST's
`/rest/v1/rpc/` endpoint, allowing authenticated users to call them directly.
These functions are internal helpers used only by triggers and RLS policies.

## Functions moved
1. `can_view_status(uuid, text, uuid)` — RLS helper for user_statuses visibility
2. `notify_new_message()` — trigger on messages INSERT
3. `notify_incoming_call()` — trigger on calls INSERT
4. `notify_message_reaction()` — trigger on message_reactions INSERT
5. `notify_new_story()` — trigger on user_statuses INSERT
6. `on_profile_display_name_set()` — trigger on profiles UPDATE

## Changes
1. Recreate all 6 functions in the `private` schema (not exposed by PostgREST)
2. Update the `select_statuses` RLS policy on `user_statuses` to reference `private.can_view_status`
3. Recreate all 5 triggers to reference `private` schema functions
4. Drop all 6 functions from `public` schema
5. Grant EXECUTE on all `private` functions to `authenticated` (needed for triggers/RLS)

## Security
- Functions are no longer callable via REST API
- Triggers and RLS policies continue to work
- EXECUTE is granted to `authenticated` only for trigger/RLS execution context
*/

-- 1. Recreate can_view_status in private schema
CREATE OR REPLACE FUNCTION private.can_view_status(
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

GRANT EXECUTE ON FUNCTION private.can_view_status(uuid, text, uuid) TO authenticated;

-- 2. Update the RLS policy to use private.can_view_status
DROP POLICY IF EXISTS "select_statuses" ON user_statuses;
CREATE POLICY "select_statuses" ON user_statuses FOR SELECT
  TO authenticated
  USING (
    private.can_view_status(user_id, visibility, auth.uid())
  );

-- 3. Recreate notify_new_message in private schema
CREATE OR REPLACE FUNCTION private.notify_new_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recipient record;
  v_recipient_ids uuid[];
  v_sender_name text;
  v_sender_avatar text;
  v_conv_name text;
  v_conv_type text;
  v_body text;
  v_title text;
  v_sound text;
  v_notif_settings jsonb;
  v_preview boolean;
  v_filtered_ids uuid[] := '{}';
  v_is_story_reply boolean := false;
BEGIN
  SELECT type, name INTO v_conv_type, v_conv_name
  FROM conversations WHERE id = NEW.conversation_id;

  SELECT display_name, avatar_url INTO v_sender_name, v_sender_avatar
  FROM profiles WHERE id = NEW.sender_id;

  IF v_sender_name IS NULL OR v_sender_name = '' THEN
    v_sender_name := 'Пользователь';
  END IF;

  UPDATE conversation_members
  SET is_muted = false, muted_until = NULL
  WHERE conversation_id = NEW.conversation_id
    AND is_muted = true
    AND muted_until IS NOT NULL
    AND muted_until <= now();

  SELECT array_agg(user_id) INTO v_recipient_ids
  FROM conversation_members
  WHERE conversation_id = NEW.conversation_id
    AND user_id != NEW.sender_id
    AND is_muted = false;

  IF v_recipient_ids IS NULL OR array_length(v_recipient_ids, 1) IS NULL THEN
    RETURN NEW;
  END IF;

  v_is_story_reply := (NEW.status_id IS NOT NULL);

  IF v_is_story_reply THEN
    CASE NEW.message_type
      WHEN 'text' THEN v_body := 'Ответ на статус: ' || COALESCE(LEFT(NEW.content, 180), '');
      WHEN 'image' THEN v_body := 'Ответ на статус: Фото';
      WHEN 'video' THEN v_body := 'Ответ на статус: Видео';
      WHEN 'voice' THEN v_body := 'Ответ на статус: Голосовое сообщение';
      WHEN 'video_note' THEN v_body := 'Ответ на статус: Видеосообщение';
      WHEN 'sticker' THEN v_body := 'Ответ на статус: ' || COALESCE(NEW.content, 'Стикер');
      ELSE v_body := 'Ответ на ваш статус';
    END CASE;
  ELSE
    CASE NEW.message_type
      WHEN 'text' THEN v_body := COALESCE(LEFT(NEW.content, 200), 'Новое сообщение');
      WHEN 'image' THEN v_body := 'Фото';
      WHEN 'video' THEN v_body := 'Видео';
      WHEN 'voice' THEN v_body := 'Голосовое сообщение';
      WHEN 'video_note' THEN v_body := 'Видеосообщение';
      WHEN 'document', 'file' THEN v_body := 'Файл';
      WHEN 'contact' THEN v_body := 'Контакт';
      WHEN 'location' THEN v_body := 'Геопозиция';
      WHEN 'sticker' THEN v_body := COALESCE(NEW.content, 'Стикер');
      WHEN 'call_started' THEN v_body := 'Входящий звонок';
      WHEN 'call_ended' THEN v_body := 'Звонок завершён';
      ELSE v_body := 'Новое сообщение';
    END CASE;
  END IF;

  FOR v_recipient IN
    SELECT p.id, p.notification_settings
    FROM profiles p
    WHERE p.id = ANY(v_recipient_ids)
  LOOP
    v_notif_settings := v_recipient.notification_settings;
    IF v_notif_settings IS NOT NULL AND (v_notif_settings->>'messages')::boolean = false THEN
      CONTINUE;
    END IF;
    IF v_conv_type = 'group'
       AND v_notif_settings IS NOT NULL
       AND (v_notif_settings->>'groups')::boolean = false THEN
      CONTINUE;
    END IF;
    v_filtered_ids := v_filtered_ids || v_recipient.id;
  END LOOP;

  IF array_length(v_filtered_ids, 1) IS NULL THEN
    RETURN NEW;
  END IF;

  IF v_conv_type = 'group' AND v_conv_name IS NOT NULL THEN
    v_title := v_conv_name;
    v_body := v_sender_name || ': ' || v_body;
  ELSE
    v_title := v_sender_name;
  END IF;

  v_sound := CASE WHEN NEW.message_type = 'call_started' THEN 'ringtone.caf' ELSE 'default' END;

  PERFORM net.http_post(
    url := 'https://wdvgbdgklbrileuyweqs.supabase.co/functions/v1/send-push-notification',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := jsonb_build_object(
      'user_ids', to_jsonb(v_filtered_ids),
      'title', v_title,
      'body', v_body,
      'data', jsonb_build_object(
        'conversation_id', NEW.conversation_id,
        'message_id', NEW.id,
        'sender_id', NEW.sender_id,
        'sender_name', v_sender_name,
        'sender_avatar', COALESCE(v_sender_avatar, ''),
        'conv_type', v_conv_type,
        'conv_name', COALESCE(v_conv_name, ''),
        'message_type', NEW.message_type,
        'type', CASE
          WHEN NEW.message_type = 'call_started' THEN 'call'
          WHEN v_is_story_reply THEN 'story_reply'
          ELSE 'message'
        END,
        'is_story_reply', v_is_story_reply,
        'status_id', COALESCE(NEW.status_id::text, '')
      ),
      'sound', v_sound,
      'categoryId', CASE WHEN v_is_story_reply THEN 'story_reply' ELSE 'message' END
    )
  );

  RETURN NEW;
END;
$$;

GRANT EXECUTE ON FUNCTION private.notify_new_message() TO authenticated;

-- Update trigger to use private function
DROP TRIGGER IF EXISTS on_new_message_notify ON messages;
CREATE TRIGGER on_new_message_notify
  AFTER INSERT ON messages
  FOR EACH ROW
  EXECUTE FUNCTION private.notify_new_message();

-- 4. Recreate notify_incoming_call in private schema
CREATE OR REPLACE FUNCTION private.notify_incoming_call()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_name text;
  v_call_type_label text;
  v_supabase_url text;
  v_service_key text;
  v_user_ids jsonb;
BEGIN
  IF NEW.status != 'ringing' THEN
    RETURN NEW;
  END IF;

  SELECT display_name INTO v_caller_name
  FROM profiles WHERE id = NEW.caller_id;

  IF v_caller_name IS NULL OR v_caller_name = '' THEN
    v_caller_name := 'Пользователь';
  END IF;

  IF NEW.call_type = 'video' THEN
    v_call_type_label := 'Входящий видеозвонок';
  ELSE
    v_call_type_label := 'Входящий звонок';
  END IF;

  IF NEW.is_group_call = true THEN
    SELECT COALESCE(jsonb_agg(cp.user_id), jsonb_build_array(NEW.receiver_id))
    INTO v_user_ids
    FROM call_participants cp
    WHERE cp.call_id = NEW.id AND cp.status = 'ringing';
  ELSE
    v_user_ids := jsonb_build_array(NEW.receiver_id);
  END IF;

  v_supabase_url := current_setting('app.settings.supabase_url', true);
  IF v_supabase_url IS NULL OR v_supabase_url = '' THEN
    SELECT decrypted_secret INTO v_supabase_url
    FROM vault.decrypted_secrets
    WHERE name = 'supabase_url'
    LIMIT 1;
  END IF;

  v_service_key := current_setting('app.settings.service_role_key', true);
  IF v_service_key IS NULL OR v_service_key = '' THEN
    SELECT decrypted_secret INTO v_service_key
    FROM vault.decrypted_secrets
    WHERE name = 'service_role_key'
    LIMIT 1;
  END IF;

  IF v_supabase_url IS NOT NULL AND v_service_key IS NOT NULL THEN
    PERFORM net.http_post(
      url := v_supabase_url || '/functions/v1/send-push-notification',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_service_key
      ),
      body := jsonb_build_object(
        'user_ids', v_user_ids,
        'title', v_caller_name,
        'body', v_call_type_label,
        'data', jsonb_build_object(
          'call_id', NEW.id,
          'caller_id', NEW.caller_id,
          'call_type', NEW.call_type,
          'type', 'call'
        ),
        'sound', 'ringtone.caf',
        'badge', 1,
        'categoryId', 'incoming_call'
      )
    );
  END IF;

  RETURN NEW;
END;
$$;

GRANT EXECUTE ON FUNCTION private.notify_incoming_call() TO authenticated;

DROP TRIGGER IF EXISTS on_new_call_notify ON calls;
CREATE TRIGGER on_new_call_notify
  AFTER INSERT ON calls
  FOR EACH ROW
  EXECUTE FUNCTION private.notify_incoming_call();

-- 5. Recreate notify_message_reaction in private schema
CREATE OR REPLACE FUNCTION private.notify_message_reaction()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_message_sender_id uuid;
  v_message_content text;
  v_message_type text;
  v_conversation_id uuid;
  v_reactor_name text;
  v_conv_name text;
  v_conv_type text;
  v_title text;
  v_body text;
  v_is_muted boolean;
  v_notif_settings jsonb;
  v_msg_preview text;
BEGIN
  SELECT sender_id, content, message_type, conversation_id
  INTO v_message_sender_id, v_message_content, v_message_type, v_conversation_id
  FROM messages WHERE id = NEW.message_id;

  IF v_message_sender_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.user_id = v_message_sender_id THEN RETURN NEW; END IF;

  SELECT is_muted INTO v_is_muted
  FROM conversation_members
  WHERE conversation_id = v_conversation_id AND user_id = v_message_sender_id;

  IF v_is_muted = true THEN RETURN NEW; END IF;

  SELECT notification_settings INTO v_notif_settings
  FROM profiles WHERE id = v_message_sender_id;

  IF v_notif_settings IS NOT NULL AND (v_notif_settings->>'messages')::boolean = false THEN
    RETURN NEW;
  END IF;

  SELECT display_name INTO v_reactor_name FROM profiles WHERE id = NEW.user_id;
  IF v_reactor_name IS NULL OR v_reactor_name = '' THEN
    v_reactor_name := 'Пользователь';
  END IF;

  SELECT type, name INTO v_conv_type, v_conv_name
  FROM conversations WHERE id = v_conversation_id;

  CASE v_message_type
    WHEN 'text' THEN v_msg_preview := LEFT(COALESCE(v_message_content, ''), 50);
    WHEN 'image' THEN v_msg_preview := 'фото';
    WHEN 'video' THEN v_msg_preview := 'видео';
    WHEN 'voice' THEN v_msg_preview := 'голосовое сообщение';
    WHEN 'video_note' THEN v_msg_preview := 'видеосообщение';
    WHEN 'sticker' THEN v_msg_preview := 'стикер';
    ELSE v_msg_preview := 'сообщение';
  END CASE;

  v_title := v_reactor_name;
  v_body := NEW.emoji || ' реакция на: ' || v_msg_preview;

  PERFORM net.http_post(
    url := 'https://wdvgbdgklbrileuyweqs.supabase.co/functions/v1/send-push-notification',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := jsonb_build_object(
      'user_ids', jsonb_build_array(v_message_sender_id),
      'title', v_title,
      'body', v_body,
      'data', jsonb_build_object(
        'conversation_id', v_conversation_id,
        'message_id', NEW.message_id,
        'type', 'reaction',
        'reactor_id', NEW.user_id,
        'reactor_name', v_reactor_name,
        'emoji', NEW.emoji
      ),
      'sound', 'default',
      'categoryId', 'reaction'
    )
  );

  RETURN NEW;
END;
$$;

GRANT EXECUTE ON FUNCTION private.notify_message_reaction() TO authenticated;

DROP TRIGGER IF EXISTS on_new_reaction_notify ON message_reactions;
CREATE TRIGGER on_new_reaction_notify
  AFTER INSERT ON message_reactions
  FOR EACH ROW
  EXECUTE FUNCTION private.notify_message_reaction();

-- 6. Recreate notify_new_story in private schema
CREATE OR REPLACE FUNCTION private.notify_new_story()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_author_name text;
  v_author_avatar text;
  v_visibility text;
  v_contact_user_ids uuid[];
  v_close_friend_ids uuid[];
  v_hidden_by_ids uuid[];
  v_eligible_ids uuid[];
  v_filtered_ids uuid[] := '{}';
  v_notif_settings jsonb;
  v_recipient record;
  v_body text;
BEGIN
  v_visibility := COALESCE(NEW.visibility, 'everyone');
  IF v_visibility = 'nobody' THEN RETURN NEW; END IF;

  SELECT display_name, avatar_url INTO v_author_name, v_author_avatar
  FROM profiles WHERE id = NEW.user_id;

  IF v_author_name IS NULL OR v_author_name = '' THEN
    v_author_name := 'Пользователь';
  END IF;

  SELECT array_agg(c.user_id) INTO v_contact_user_ids
  FROM contacts c WHERE c.contact_id = NEW.user_id;

  IF v_contact_user_ids IS NULL OR array_length(v_contact_user_ids, 1) IS NULL THEN
    RETURN NEW;
  END IF;

  IF v_visibility = 'close_friends' THEN
    SELECT array_agg(cf.friend_id) INTO v_close_friend_ids
    FROM close_friends cf WHERE cf.user_id = NEW.user_id;
    IF v_close_friend_ids IS NULL THEN RETURN NEW; END IF;
    SELECT array_agg(uid) INTO v_eligible_ids
    FROM unnest(v_contact_user_ids) AS uid
    WHERE uid = ANY(v_close_friend_ids);
  ELSE
    v_eligible_ids := v_contact_user_ids;
  END IF;

  IF v_eligible_ids IS NULL OR array_length(v_eligible_ids, 1) IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT array_agg(hs.user_id) INTO v_hidden_by_ids
  FROM hidden_statuses hs
  WHERE hs.hidden_user_id = NEW.user_id AND hs.user_id = ANY(v_eligible_ids);

  IF v_hidden_by_ids IS NOT NULL THEN
    SELECT array_agg(uid) INTO v_eligible_ids
    FROM unnest(v_eligible_ids) AS uid
    WHERE uid != ALL(v_hidden_by_ids);
  END IF;

  IF v_eligible_ids IS NULL OR array_length(v_eligible_ids, 1) IS NULL THEN
    RETURN NEW;
  END IF;

  FOR v_recipient IN
    SELECT p.id, p.notification_settings
    FROM profiles p WHERE p.id = ANY(v_eligible_ids)
  LOOP
    v_notif_settings := v_recipient.notification_settings;
    IF v_notif_settings IS NOT NULL AND (v_notif_settings->>'stories')::boolean = false THEN
      CONTINUE;
    END IF;
    v_filtered_ids := v_filtered_ids || v_recipient.id;
  END LOOP;

  IF array_length(v_filtered_ids, 1) IS NULL THEN RETURN NEW; END IF;

  CASE NEW.media_type
    WHEN 'image' THEN v_body := 'Фото';
    WHEN 'video' THEN v_body := 'Видео';
    WHEN 'voice' THEN v_body := 'Голосовое';
    ELSE v_body := COALESCE(LEFT(NEW.content, 100), 'Новая история');
  END CASE;

  PERFORM net.http_post(
    url := 'https://wdvgbdgklbrileuyweqs.supabase.co/functions/v1/send-push-notification',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := jsonb_build_object(
      'user_ids', to_jsonb(v_filtered_ids),
      'title', v_author_name || ' — история',
      'body', v_body,
      'data', jsonb_build_object(
        'type', 'story',
        'status_id', NEW.id,
        'author_id', NEW.user_id,
        'author_name', v_author_name,
        'author_avatar', COALESCE(v_author_avatar, ''),
        'media_type', COALESCE(NEW.media_type, 'text')
      ),
      'sound', 'default',
      'categoryId', 'story'
    )
  );

  RETURN NEW;
END;
$$;

GRANT EXECUTE ON FUNCTION private.notify_new_story() TO authenticated;

DROP TRIGGER IF EXISTS on_new_story_notify ON user_statuses;
CREATE TRIGGER on_new_story_notify
  AFTER INSERT ON user_statuses
  FOR EACH ROW
  EXECUTE FUNCTION private.notify_new_story();

-- 7. Recreate on_profile_display_name_set in private schema
CREATE OR REPLACE FUNCTION private.on_profile_display_name_set()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pending RECORD;
BEGIN
  IF (OLD.display_name IS NOT NULL AND OLD.display_name <> '') THEN
    RETURN NEW;
  END IF;
  IF (NEW.display_name IS NULL OR NEW.display_name = '') THEN
    RETURN NEW;
  END IF;

  FOR pending IN
    SELECT pc.id, pc.user_id, pc.nickname
    FROM pending_contacts pc
    WHERE pc.phone = NEW.phone
  LOOP
    INSERT INTO contact_join_notifications (user_id, joined_user_id)
    VALUES (pending.user_id, NEW.id)
    ON CONFLICT DO NOTHING;

    INSERT INTO contacts (user_id, contact_id, nickname)
    VALUES (pending.user_id, NEW.id, pending.nickname)
    ON CONFLICT (user_id, contact_id) DO NOTHING;

    DELETE FROM pending_contacts WHERE id = pending.id;
  END LOOP;

  RETURN NEW;
END;
$$;

GRANT EXECUTE ON FUNCTION private.on_profile_display_name_set() TO authenticated;

DROP TRIGGER IF EXISTS trigger_profile_display_name_set ON profiles;
CREATE TRIGGER trigger_profile_display_name_set
  AFTER UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION private.on_profile_display_name_set();

-- 8. Drop old public schema functions (now safe since triggers/policies reference private versions)
DROP FUNCTION IF EXISTS public.can_view_status(uuid, text, uuid);
DROP FUNCTION IF EXISTS public.notify_new_message();
DROP FUNCTION IF EXISTS public.notify_incoming_call();
DROP FUNCTION IF EXISTS public.notify_message_reaction();
DROP FUNCTION IF EXISTS public.notify_new_story();
DROP FUNCTION IF EXISTS public.on_profile_display_name_set();