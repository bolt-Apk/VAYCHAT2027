/*
# Enable realtime for conversation_members

1. Changes
  - Set REPLICA IDENTITY FULL on conversation_members so DELETE events include row data
  - Add conversation_members to supabase_realtime publication

2. Reason
  - Without FULL replica identity, DELETE events do not include column values like user_id,
    which means realtime filters (e.g. filter by user_id) cannot work for DELETE events.
  - Without being in the publication, no realtime events fire at all for this table.

3. Impact
  - Chat list will now update in real-time when a user deletes/leaves a conversation.
*/

ALTER TABLE conversation_members REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE conversation_members;
