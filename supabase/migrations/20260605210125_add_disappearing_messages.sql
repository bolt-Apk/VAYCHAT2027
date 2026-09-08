-- Add expires_at column for disappearing messages
ALTER TABLE messages ADD COLUMN IF NOT EXISTS expires_at timestamptz;

-- Create index for efficient cleanup
CREATE INDEX IF NOT EXISTS idx_messages_expires_at ON messages(expires_at) WHERE expires_at IS NOT NULL;
