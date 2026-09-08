/*
# Add missing indexes on foreign key columns and CHECK constraints

## Problem
Several foreign key columns used in JOINs, RLS policies, and trigger lookups lack indexes,
causing sequential scans on hot tables. Two enum-like columns lack CHECK constraints,
allowing invalid values.

## New Indexes
1. `idx_messages_reply_to_id` on messages(reply_to_id) WHERE reply_to_id IS NOT NULL
   - Used when loading reply context for threaded messages
2. `idx_messages_forwarded_from_id` on messages(forwarded_from_id) WHERE forwarded_from_id IS NOT NULL
   - Used when resolving forwarded message origin
3. `idx_status_views_status_id` on status_views(status_id)
   - Used by RLS policy subquery checking status ownership
4. `idx_status_views_viewer_id` on status_views(viewer_id)
   - Used by RLS policy checking viewer access
5. `idx_contact_join_notifications_joined_user_id` on contact_join_notifications(joined_user_id)
   - Used by profile setup trigger to find affected notification rows
6. `idx_pending_contacts_phone` on pending_contacts(phone)
   - Used by on_profile_display_name_set trigger to match phone numbers
7. `idx_pinned_saved_messages_message_id` on pinned_saved_messages(message_id)
   - Used when loading pinned message details
8. `idx_hidden_statuses_user_id` on hidden_statuses(user_id)
   - Used by RLS policies and story notification trigger
9. `idx_contacts_contact_id` on contacts(contact_id)
   - Used by can_view_status() for mutual contact checks and cascade deletes

## New CHECK Constraints
1. call_participants.status restricted to valid values: ringing, active, declined, missed, left
2. push_tokens.platform restricted to valid values: ios, android, web

## Important Notes
1. All statements use IF NOT EXISTS for idempotency
2. CHECK constraints use DO blocks to check existence before adding
3. All indexes are non-destructive additions that improve query performance
4. Partial indexes used where NULLs dominate (reply_to_id, forwarded_from_id)
*/

-- Messages: thread and forward lookups
CREATE INDEX IF NOT EXISTS idx_messages_reply_to_id
  ON messages(reply_to_id) WHERE reply_to_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_messages_forwarded_from_id
  ON messages(forwarded_from_id) WHERE forwarded_from_id IS NOT NULL;

-- Status views: RLS policy performance
CREATE INDEX IF NOT EXISTS idx_status_views_status_id
  ON status_views(status_id);

CREATE INDEX IF NOT EXISTS idx_status_views_viewer_id
  ON status_views(viewer_id);

-- Contact join notifications: trigger lookup
CREATE INDEX IF NOT EXISTS idx_contact_join_notifications_joined_user_id
  ON contact_join_notifications(joined_user_id);

-- Pending contacts: phone matching in trigger
CREATE INDEX IF NOT EXISTS idx_pending_contacts_phone
  ON pending_contacts(phone);

-- Pinned saved messages: message detail lookup
CREATE INDEX IF NOT EXISTS idx_pinned_saved_messages_message_id
  ON pinned_saved_messages(message_id);

-- Hidden statuses: RLS and notification trigger
CREATE INDEX IF NOT EXISTS idx_hidden_statuses_user_id
  ON hidden_statuses(user_id);

-- Contacts: mutual contact checks in can_view_status() and cascade deletes
CREATE INDEX IF NOT EXISTS idx_contacts_contact_id
  ON contacts(contact_id);

-- CHECK constraints for enum-like columns
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'call_participants_status_check'
  ) THEN
    ALTER TABLE call_participants
      ADD CONSTRAINT call_participants_status_check
      CHECK (status IN ('ringing', 'active', 'declined', 'missed', 'left'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'push_tokens_platform_check'
  ) THEN
    ALTER TABLE push_tokens
      ADD CONSTRAINT push_tokens_platform_check
      CHECK (platform IN ('ios', 'android', 'web'));
  END IF;
END $$;
