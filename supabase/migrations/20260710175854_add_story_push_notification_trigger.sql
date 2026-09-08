/*
# Add push notification trigger for new stories

1. New Function
  - `notify_new_story()` — SECURITY DEFINER trigger function on `user_statuses`
  - Fires AFTER INSERT on `user_statuses`
  - Sends push notifications to the author's contacts who are allowed to see the story

2. Logic
  - Looks up the story author's display name and avatar from `profiles`
  - Finds all users who have the author in their `contacts` table
  - Filters recipients by story visibility:
    - 'everyone' → all contacts
    - 'contacts' → all contacts (same result)
    - 'close_friends' → only users in the author's `close_friends` table
    - 'nobody' → no notifications
  - Removes users who have hidden the author's stories (`hidden_statuses`)
  - Checks each recipient's `notification_settings` JSONB for a `stories` flag (default true)
  - Sends push via the existing `send-push-notification` edge function
  - Push payload includes type='story', author info, and status_id for deep linking

3. Security
  - Function is SECURITY DEFINER with restricted search_path
  - Uses existing push notification infrastructure

4. Important Notes
  - Idempotent: uses CREATE OR REPLACE and DROP TRIGGER IF EXISTS
  - Does NOT notify for stories with visibility='nobody'
  - Respects per-user notification preferences
*/

CREATE OR REPLACE FUNCTION public.notify_new_story()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
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

  IF v_visibility = 'nobody' THEN
    RETURN NEW;
  END IF;

  SELECT display_name, avatar_url INTO v_author_name, v_author_avatar
  FROM profiles WHERE id = NEW.user_id;

  IF v_author_name IS NULL OR v_author_name = '' THEN
    v_author_name := 'Пользователь';
  END IF;

  SELECT array_agg(c.user_id) INTO v_contact_user_ids
  FROM contacts c
  WHERE c.contact_id = NEW.user_id;

  IF v_contact_user_ids IS NULL OR array_length(v_contact_user_ids, 1) IS NULL THEN
    RETURN NEW;
  END IF;

  IF v_visibility = 'close_friends' THEN
    SELECT array_agg(cf.friend_id) INTO v_close_friend_ids
    FROM close_friends cf
    WHERE cf.user_id = NEW.user_id;

    IF v_close_friend_ids IS NULL THEN
      RETURN NEW;
    END IF;

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
  WHERE hs.hidden_user_id = NEW.user_id
    AND hs.user_id = ANY(v_eligible_ids);

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
    FROM profiles p
    WHERE p.id = ANY(v_eligible_ids)
  LOOP
    v_notif_settings := v_recipient.notification_settings;

    IF v_notif_settings IS NOT NULL AND (v_notif_settings->>'stories')::boolean = false THEN
      CONTINUE;
    END IF;

    v_filtered_ids := v_filtered_ids || v_recipient.id;
  END LOOP;

  IF array_length(v_filtered_ids, 1) IS NULL THEN
    RETURN NEW;
  END IF;

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

DROP TRIGGER IF EXISTS on_new_story_notify ON user_statuses;
CREATE TRIGGER on_new_story_notify
  AFTER INSERT ON user_statuses
  FOR EACH ROW
  EXECUTE FUNCTION notify_new_story();
