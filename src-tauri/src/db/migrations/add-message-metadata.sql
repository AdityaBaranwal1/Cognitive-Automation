-- Add metadata column to messages table for model-switch and other metadata
ALTER TABLE messages ADD COLUMN metadata TEXT;
