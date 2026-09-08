/*
# Add voice trim metadata to user_statuses

1. Modified Tables
   - `user_statuses`
     - `trim_start_pct` (real, default 0) - trim start position as percentage (0-100)
     - `trim_end_pct` (real, default 100) - trim end position as percentage (0-100)

2. Important Notes
   - These columns store trim boundaries so playback can skip to the correct portion
   - This avoids the need for native audio processing libraries on iOS/Android
   - Web and native platforms both use the same metadata approach
*/

ALTER TABLE user_statuses ADD COLUMN IF NOT EXISTS trim_start_pct real NOT NULL DEFAULT 0;
ALTER TABLE user_statuses ADD COLUMN IF NOT EXISTS trim_end_pct real NOT NULL DEFAULT 100;
