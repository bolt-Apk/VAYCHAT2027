/*
# Revoke public execute on notify_new_message

## Problem
The SECURITY DEFINER function `notify_new_message()` is callable via REST API
by anon and authenticated roles, which is a security risk.

## Fix
Revoke EXECUTE from PUBLIC (which covers anon + authenticated).
The function will still fire from the database trigger since triggers
execute with the table owner's permissions, not the caller's.
*/

REVOKE EXECUTE ON FUNCTION public.notify_new_message() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.notify_new_message() FROM anon;
REVOKE EXECUTE ON FUNCTION public.notify_new_message() FROM authenticated;