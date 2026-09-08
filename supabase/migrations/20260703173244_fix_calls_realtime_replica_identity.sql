-- Set REPLICA IDENTITY FULL so Realtime filters on non-PK columns work correctly
ALTER TABLE calls REPLICA IDENTITY FULL;
