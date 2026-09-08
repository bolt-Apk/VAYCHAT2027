-- Translate push notification body text to Russian
CREATE OR REPLACE FUNCTION public.notify_new_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_recipient_ids uuid[];
  v_sender_name text;
  v_conv_name text;
  v_conv_type text;
  v_body text;
  v_supabase_url text;
  v_service_key text;
BEGIN
  SELECT type, name INTO v_conv_type, v_conv_name
  FROM conversations WHERE id = NEW.conversation_id;

  SELECT array_agg(user_id) INTO v_recipient_ids
  FROM conversation_members
  WHERE conversation_id = NEW.conversation_id
    AND user_id != NEW.sender_id;

  IF v_recipient_ids IS NULL OR array_length(v_recipient_ids, 1) IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT display_name INTO v_sender_name
  FROM profiles WHERE id = NEW.sender_id;

  IF v_sender_name IS NULL THEN
    v_sender_name := 'Пользователь';
  END IF;

  CASE NEW.message_type
    WHEN 'text' THEN
      v_body := COALESCE(LEFT(NEW.content, 200), 'Новое сообщение');
    WHEN 'image' THEN
      v_body := 'Отправил(а) фото';
    WHEN 'video' THEN
      v_body := 'Отправил(а) видео';
    WHEN 'voice' THEN
      v_body := 'Отправил(а) голосовое сообщение';
    WHEN 'document' THEN
      v_body := 'Отправил(а) документ';
    WHEN 'call_started' THEN
      v_body := 'Входящий звонок';
    WHEN 'call_ended' THEN
      v_body := 'Звонок завершён';
    ELSE
      v_body := 'Новое сообщение';
  END CASE;

  IF v_conv_type = 'group' THEN
    v_body := v_sender_name || ': ' || v_body;
  END IF;

  IF v_conv_type = 'group' AND v_conv_name IS NOT NULL THEN
    NULL;
  ELSE
    v_conv_name := v_sender_name;
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
        'user_ids', to_jsonb(v_recipient_ids),
        'title', v_conv_name,
        'body', v_body,
        'data', jsonb_build_object(
          'conversation_id', NEW.conversation_id,
          'message_id', NEW.id,
          'type', CASE WHEN NEW.message_type = 'call_started' THEN 'call' ELSE 'message' END
        ),
        'sound', CASE WHEN NEW.message_type = 'call_started' THEN 'ringtone.caf' ELSE 'default' END
      )
    );
  END IF;

  RETURN NEW;
END;
$$;