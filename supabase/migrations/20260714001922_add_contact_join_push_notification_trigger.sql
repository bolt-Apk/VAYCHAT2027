/*
# Add push notification trigger for contact join notifications

1. Changes
   - Creates `private.notify_contact_joined()` trigger function
   - Fires when a new row is inserted into `contact_join_notifications`
   - Sends push notification to `user_id` telling them that `joined_user_id` joined VayChat
   - Uses vault-based Authorization header (same pattern as all other triggers)

2. Security
   - Function is SECURITY DEFINER in `private` schema
   - EXECUTE revoked from public/anon/authenticated
   - Uses Authorization: Bearer <service_role_key> for edge function calls

3. Important Notes
   - Notification text: "<display_name> присоединился(ась) к VayChat!"
   - Category: 'contact_joined' (can be used for client-side handling)
*/

CREATE OR REPLACE FUNCTION private.notify_contact_joined()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_joined_name text;
  v_secret text;
BEGIN
  SELECT display_name INTO v_joined_name
  FROM public.profiles WHERE id = NEW.joined_user_id;

  IF v_joined_name IS NULL OR v_joined_name = '' THEN
    v_joined_name := 'Пользователь';
  END IF;

  v_secret := private.get_push_secret();

  PERFORM net.http_post(
    url := 'https://wdvgbdgklbrileuyweqs.supabase.co/functions/v1/send-push-notification',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_secret
    ),
    body := jsonb_build_object(
      'user_ids', jsonb_build_array(NEW.user_id),
      'title', 'VayChat',
      'body', v_joined_name || ' присоединился(ась) к VayChat!',
      'data', jsonb_build_object(
        'joined_user_id', NEW.joined_user_id,
        'type', 'contact_joined'
      ),
      'categoryId', 'contact_joined'
    )
  );

  RETURN NEW;
END;
$$;

GRANT EXECUTE ON FUNCTION private.notify_contact_joined() TO postgres;
REVOKE EXECUTE ON FUNCTION private.notify_contact_joined() FROM public, anon, authenticated;

-- Create trigger on contact_join_notifications table
DROP TRIGGER IF EXISTS trg_notify_contact_joined ON public.contact_join_notifications;
CREATE TRIGGER trg_notify_contact_joined
  AFTER INSERT ON public.contact_join_notifications
  FOR EACH ROW
  EXECUTE FUNCTION private.notify_contact_joined();
