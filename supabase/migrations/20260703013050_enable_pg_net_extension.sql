/*
# Enable pg_net extension

## Purpose
pg_net is required for database triggers to make HTTP requests to edge functions.
This is needed for the push notification trigger to call the send-push-notification
edge function when new messages are inserted.

## Changes
- Enable the pg_net extension in the extensions schema
*/

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;