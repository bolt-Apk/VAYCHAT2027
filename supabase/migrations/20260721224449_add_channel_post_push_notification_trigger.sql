/*
  # Add push notification trigger for channel posts

  When a new message is posted in a channel conversation, notify all subscribers
  who have not muted the channel.

  1. New Function
    - `private.notify_channel_post()` — trigger function on messages INSERT.
      Fires only for channel conversations. Collects non-muted subscriber IDs
      from conversation_members, respects per-user notification settings (checks
      `channels` key in profiles.notification_settings), and calls the existing
      `send-push-notification` edge function.

  2. New Trigger
    - `on_channel_post_notify` on public.messages AFTER INSERT — invokes
      `private.notify_channel_post()`.

  3. Notes
    - The existing `notify_new_message` trigger already skips channel messages,
      so there is no duplication.
    - Uses the same `net.http_post` pattern as other notification triggers.
    - Title is the channel name; body is the message preview.
    - Subscribers who muted the channel (is_muted=true) are excluded.
    - Subscribers whose notification_settings.channels = false are excluded.
*/

CREATE OR REPLACE FUNCTION private.notify_channel_post()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_conv_type text;
  v_conv_name text;
  v_sender_name text;
  v_sender_avatar text;
  v_body text;
  v_recipient_ids uuid[];
  v_filtered_ids uuid[] := '{}';
  v_recipient record;
  v_notif_settings jsonb;
  v_media_url text := '';
BEGIN
  -- Only handle channel conversations
  SELECT type, name INTO v_conv_type, v_conv_name
  FROM public.conversations WHERE id = NEW.conversation_id;

  IF v_conv_type IS DISTINCT FROM 'channel' THEN
    RETURN NEW;
  END IF;

  -- Skip call system messages
  IF NEW.message_type IN ('call', 'call_started', 'call_ended') THEN
    RETURN NEW;
  END IF;

  -- Get sender info
  SELECT display_name, avatar_url INTO v_sender_name, v_sender_avatar
  FROM public.profiles WHERE id = NEW.sender_id;

  IF v_sender_name IS NULL OR v_sender_name = '' THEN
    v_sender_name := 'Администратор';
  END IF;

  -- Get media URL for image/video messages
  IF NEW.message_type IN ('image', 'video') AND NEW.media_url IS NOT NULL THEN
    v_media_url := NEW.media_url;
  END IF;

  -- Build body based on message type
  CASE NEW.message_type
    WHEN 'text' THEN v_body := COALESCE(LEFT(NEW.content, 200), 'Новая публикация');
    WHEN 'image' THEN v_body := 'Фото';
    WHEN 'video' THEN v_body := 'Видео';
    WHEN 'voice' THEN v_body := 'Голосовое сообщение';
    WHEN 'video_note' THEN v_body := 'Видеосообщение';
    WHEN 'document', 'file' THEN v_body := 'Файл';
    WHEN 'sticker' THEN v_body := COALESCE(NEW.content, 'Стикер');
    WHEN 'forwarded' THEN v_body := 'Пересланное сообщение';
    ELSE v_body := 'Новая публикация';
  END CASE;

  -- Clear expired mutes
  UPDATE public.conversation_members
  SET is_muted = false, muted_until = NULL
  WHERE conversation_id = NEW.conversation_id
    AND is_muted = true
    AND muted_until IS NOT NULL
    AND muted_until <= now();

  -- Get non-muted subscribers (conversation_members with role='member' who are not the sender)
  SELECT array_agg(user_id) INTO v_recipient_ids
  FROM public.conversation_members
  WHERE conversation_id = NEW.conversation_id
    AND user_id != NEW.sender_id
    AND is_muted = false;

  IF v_recipient_ids IS NULL OR array_length(v_recipient_ids, 1) IS NULL THEN
    RETURN NEW;
  END IF;

  -- Filter by per-user notification settings (key: "channels")
  FOR v_recipient IN
    SELECT p.id, p.notification_settings
    FROM public.profiles p
    WHERE p.id = ANY(v_recipient_ids)
  LOOP
    v_notif_settings := v_recipient.notification_settings;
    -- If user explicitly disabled channel notifications, skip
    IF v_notif_settings IS NOT NULL AND (v_notif_settings->>'channels')::boolean = false THEN
      CONTINUE;
    END IF;
    v_filtered_ids := v_filtered_ids || v_recipient.id;
  END LOOP;

  IF array_length(v_filtered_ids, 1) IS NULL THEN
    RETURN NEW;
  END IF;

  -- Send push notification via edge function
  PERFORM net.http_post(
    url := 'https://tdzetpypwohhxdcllblp.supabase.co/functions/v1/send-push-notification',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := jsonb_build_object(
      'user_ids', to_jsonb(v_filtered_ids),
      'title', COALESCE(v_conv_name, 'Канал'),
      'body', v_body,
      'data', jsonb_build_object(
        'conversation_id', NEW.conversation_id,
        'message_id', NEW.id,
        'sender_id', NEW.sender_id,
        'sender_name', v_sender_name,
        'sender_avatar', COALESCE(v_sender_avatar, ''),
        'conv_type', 'channel',
        'conv_name', COALESCE(v_conv_name, ''),
        'message_type', NEW.message_type,
        'media_url', v_media_url,
        'type', 'channel_post'
      ),
      'sound', 'default',
      'categoryId', 'message',
      'channelId', 'messages',
      'threadId', NEW.conversation_id::text
    )
  );

  RETURN NEW;
END;
$$;

-- Revoke direct execute from public/anon
REVOKE EXECUTE ON FUNCTION private.notify_channel_post() FROM public;
REVOKE EXECUTE ON FUNCTION private.notify_channel_post() FROM anon;
REVOKE EXECUTE ON FUNCTION private.notify_channel_post() FROM authenticated;

-- Create trigger
DROP TRIGGER IF EXISTS on_channel_post_notify ON public.messages;
CREATE TRIGGER on_channel_post_notify
  AFTER INSERT ON public.messages
  FOR EACH ROW
  EXECUTE FUNCTION private.notify_channel_post();
