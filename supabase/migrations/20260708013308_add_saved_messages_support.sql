/*
# Add Saved Messages (Избранное) support

## Overview
Adds infrastructure for Telegram-style "Saved Messages" feature where users can
forward/save messages, files, photos, and notes for personal storage.

## Approach
- Uses the existing `conversations` table with a new type 'saved' for each user's
  personal saved messages conversation.
- A `pinned_saved_messages` table allows users to pin important notes/messages
  to the top of their Saved Messages.

## 1. New Tables
- `pinned_saved_messages`
  - `id` (uuid, primary key)
  - `user_id` (uuid, FK to auth.users, owner, defaults to auth.uid())
  - `message_id` (uuid, FK to messages)
  - `created_at` (timestamptz)
  - UNIQUE(user_id, message_id)

## 2. Modified Tables
- `conversations` - now supports type 'saved' in addition to 'direct' and 'group'

## 3. Security
- RLS enabled on `pinned_saved_messages`
- Owner-scoped CRUD policies (authenticated only)

## 4. Indexes
- Index on pinned_saved_messages(user_id) for fast lookups

## 5. Important Notes
- Each user gets exactly one 'saved' conversation, created on first access
- The 'saved' conversation works like a regular chat where the user is both sender and only member
- Pinned messages float to the top of the Saved Messages view
*/

-- Allow 'saved' as a conversation type (no constraint to modify, type is text)

-- Create pinned_saved_messages table
CREATE TABLE IF NOT EXISTS pinned_saved_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, message_id)
);

ALTER TABLE pinned_saved_messages ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_pinned_saved_messages_user_id ON pinned_saved_messages(user_id);

-- RLS policies for pinned_saved_messages
DROP POLICY IF EXISTS "select_own_pinned_saved" ON pinned_saved_messages;
CREATE POLICY "select_own_pinned_saved" ON pinned_saved_messages FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_pinned_saved" ON pinned_saved_messages;
CREATE POLICY "insert_own_pinned_saved" ON pinned_saved_messages FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_pinned_saved" ON pinned_saved_messages;
CREATE POLICY "update_own_pinned_saved" ON pinned_saved_messages FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_pinned_saved" ON pinned_saved_messages;
CREATE POLICY "delete_own_pinned_saved" ON pinned_saved_messages FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

-- Add index on conversations for finding saved conversations quickly
CREATE INDEX IF NOT EXISTS idx_conversations_type ON conversations(type);
