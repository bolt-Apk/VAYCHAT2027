/*
  # Fix get_channel_subscriber_count security flag

  1. Security change
    - `public.get_channel_subscriber_count(uuid)` was declared SECURITY DEFINER,
      which made it executable by anon/authenticated roles with the function
      owner's elevated privileges via /rest/v1/rpc/get_channel_subscriber_count.
    - The function body is a plain COUNT on public.channel_subscribers with no
      need for elevated privileges, and channel_subscribers already has RLS.
    - Switch the function to SECURITY INVOKER so it runs with the caller's
      role/privileges and RLS policies apply naturally.
    - Keep the explicit REVOKE EXECUTE FROM public as defense-in-depth so only
      authenticated can call it (anon has no reason to query subscriber counts).

  2. Notes
    - No data changes. No schema changes. Function signature unchanged.
    - Safe to re-run.
*/

CREATE OR REPLACE FUNCTION public.get_channel_subscriber_count(p_channel_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO ''
AS $$
  SELECT count(*)::integer FROM public.channel_subscribers
  WHERE channel_id = p_channel_id;
$$;

REVOKE EXECUTE ON FUNCTION public.get_channel_subscriber_count(uuid) FROM public;
REVOKE EXECUTE ON FUNCTION public.get_channel_subscriber_count(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_channel_subscriber_count(uuid) TO authenticated;
