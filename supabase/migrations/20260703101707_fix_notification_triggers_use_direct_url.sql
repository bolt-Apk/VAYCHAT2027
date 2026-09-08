/*
# Fix notification triggers to use direct edge function URL

## Problem
Both `notify_new_message()` and `notify_incoming_call()` try to read 
Supabase URL and service role key from vault secrets or app.settings,
but neither is configured. This means push notifications silently fail.

## Fix
Use the hardcoded edge function URL directly (same as the original 
working version). The edge function was deployed with verify_jwt=false,
so no Authorization header is needed.
*/

-- Fix message notification trigger
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
BEGIN
  SELECT type, name INTO v_conv_type, v_conv_name
  FROM conversations WHERE id = NEW.conversation_id;

  SELECT array_agg(user_id) INTO v_recipient_ids
  FROM conversation_members
  WHERE conversation_id = NEW.conversation_id
    AND user_id != NEW.sender_id
    AND is_muted = false;

  IF v_recipient_ids IS NULL OR array_length(v_recipient_ids, 1) IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT display_name INTO v_sender_name
  FROM profiles WHERE id = NEW.sender_id;

  IF v_sender_name IS NULL OR v_sender_name = '' THEN
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
      v_body := 'Голосовое сообщение';
    WHEN 'document' THEN
      v_body := 'Отправил(а) документ';
    WHEN 'file' THEN
      v_body := 'Отправил(а) файл';
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

  PERFORM net.http_post(
    url := 'https://wdvgbdgklbrileuyweqs.supabase.co/functions/v1/send-push-notification',
    headers := '{"Content-Type": "application/json"}'::jsonb,
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

  RETURN NEW;
END;
$$;

-- Fix call notification trigger
CREATE OR REPLACE FUNCTION public.notify_incoming_call()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_caller_name text;
  v_call_type_label text;
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

  PERFORM net.http_post(
    url := 'https://wdvgbdgklbrileuyweqs.supabase.co/functions/v1/send-push-notification',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := jsonb_build_object(
      'user_ids', jsonb_build_array(NEW.receiver_id),
      'title', v_caller_name,
      'body', v_call_type_label,
      'data', jsonb_build_object(
        'call_id', NEW.id,
        'caller_id', NEW.caller_id,
        'call_type', NEW.call_type,
        'type', 'call'
      ),
      'sound', 'ringtone.caf',
      'badge', 1
    )
  );

  RETURN NEW;
END;
$$;
