/*
# Fix conversation_members INSERT policy

## Problem
When a user creates a new conversation and then inserts members:
1. INSERT self as member (works via auth.uid() = user_id)
2. INSERT other user as member (fails because get_user_conversation_ids may not yet see the self-insert)

This causes the other user to never be added to the conversation, resulting in broken/empty chats.

## Solution
Add a third condition to the INSERT policy: if the authenticated user is the `created_by` owner
of the conversation, they can add any member to it. This removes the dependency on the
self-insert being visible before adding other members.

## Security changes
- Updated INSERT policy on conversation_members to also allow conversation creators to add members
*/

-- Drop and recreate the INSERT policy with the creator condition
DROP POLICY IF EXISTS "Members can add users to their conversations" ON conversation_members;

CREATE POLICY "Members can add users to their conversations"
ON conversation_members FOR INSERT
TO authenticated
WITH CHECK (
  (auth.uid() = user_id)
  OR (conversation_id IN (SELECT private.get_user_conversation_ids(auth.uid())))
  OR (EXISTS (
    SELECT 1 FROM conversations
    WHERE conversations.id = conversation_members.conversation_id
    AND conversations.created_by = auth.uid()
  ))
);