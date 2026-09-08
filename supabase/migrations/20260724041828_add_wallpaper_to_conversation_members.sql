/*
# Add per-chat wallpaper column to conversation_members

1. Modified Tables
   - `conversation_members`
     - `wallpaper` (jsonb, nullable) — stores user's chosen wallpaper config for a specific chat (type + value)

2. Security
   - Existing RLS policies on conversation_members already cover this column (no new policies needed).

3. Notes
   - Previously wallpaper was stored only in localStorage which gets lost on cache clear.
   - Now persisted server-side per user per conversation.
*/

ALTER TABLE conversation_members ADD COLUMN IF NOT EXISTS wallpaper jsonb DEFAULT NULL;
