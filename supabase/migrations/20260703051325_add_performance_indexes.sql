/*
# Add performance indexes for frequently queried columns

## Problem
Several queries lack indexes, causing full table scans on hot paths like
unread counts, message loading, membership lookups, story queries, etc.

## Indexes added
1. idx_messages_conversation_unread - partial index for unread count queries
2. idx_messages_conversation_created - ordered message loading in chats
3. idx_conversation_members_user - membership lookups
4. idx_blocked_users_user - block list queries
5. idx_user_statuses_expires - active story queries
6. idx_message_reactions_message - reactions per message
7. idx_starred_messages_user - starred messages list
8. idx_calls_caller - call history by caller
9. idx_calls_receiver - call history by receiver
10. idx_push_tokens_user - push notification delivery
11. idx_messages_sender - sender profile lookups
12. idx_profiles_phone - contact matching by phone
*/

CREATE INDEX IF NOT EXISTS idx_messages_conversation_unread
  ON messages (conversation_id, sender_id)
  WHERE is_read = false;

CREATE INDEX IF NOT EXISTS idx_messages_conversation_created
  ON messages (conversation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_conversation_members_user
  ON conversation_members (user_id, conversation_id);

CREATE INDEX IF NOT EXISTS idx_blocked_users_user
  ON blocked_users (user_id, blocked_user_id);

CREATE INDEX IF NOT EXISTS idx_user_statuses_expires
  ON user_statuses (expires_at DESC);

CREATE INDEX IF NOT EXISTS idx_message_reactions_message
  ON message_reactions (message_id);

CREATE INDEX IF NOT EXISTS idx_starred_messages_user
  ON starred_messages (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_calls_caller
  ON calls (caller_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_calls_receiver
  ON calls (receiver_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_push_tokens_user
  ON push_tokens (user_id);

CREATE INDEX IF NOT EXISTS idx_messages_sender
  ON messages (sender_id);

CREATE INDEX IF NOT EXISTS idx_profiles_phone
  ON profiles (phone);
