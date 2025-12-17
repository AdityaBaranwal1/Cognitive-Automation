-- Migration: Add provider tracking columns to conversations
-- This allows conversations to remember which LLM provider/model created them

-- Add provider_id column (nullable for backward compatibility)
ALTER TABLE conversations ADD COLUMN provider_id TEXT;

-- Add model column (nullable for backward compatibility)
ALTER TABLE conversations ADD COLUMN model TEXT;
