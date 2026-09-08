/*
# Revoke public EXECUTE on SECURITY DEFINER functions

## Problem
Three SECURITY DEFINER functions are callable by anon and authenticated roles
via the PostgREST /rpc/ endpoint, which is unintended. They are only meant to
be invoked internally by triggers.

## Functions affected
1. `public.cleanup_expired_statuses()` — called internally to purge old statuses
2. `public.notify_incoming_call()` — trigger function for call push notifications
3. `public.on_profile_display_name_set()` — trigger function for contact-join notifications

## Security changes
- REVOKE EXECUTE from `anon`, `authenticated`, and `public` on all three functions
- They remain callable by trigger owners (superuser / table owner)
*/

REVOKE EXECUTE ON FUNCTION public.cleanup_expired_statuses() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.notify_incoming_call() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.on_profile_display_name_set() FROM anon, authenticated, public;
