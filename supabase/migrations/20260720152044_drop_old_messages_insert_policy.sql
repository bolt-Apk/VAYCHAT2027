/*
# Drop old messages INSERT policy

The old "Members can send messages to their conversations" INSERT policy allows
any conversation member to post without the channel restriction. Since Postgres
OR's multiple policies together, the old permissive policy would bypass the new
channel-only-admin restriction. Dropping it so only the new policy applies.
*/

DROP POLICY IF EXISTS "Members can send messages to their conversations" ON messages;
