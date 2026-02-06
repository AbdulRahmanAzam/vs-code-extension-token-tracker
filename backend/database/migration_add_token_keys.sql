-- =====================================================
-- Migration: Add device_token_keys table
-- Enables users to generate keys for devices
-- =====================================================

CREATE TABLE IF NOT EXISTS device_token_keys (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_key VARCHAR(64) UNIQUE NOT NULL,
  label VARCHAR(100) DEFAULT 'Device Key',
  allocated_tokens INTEGER DEFAULT 50,
  is_used BOOLEAN DEFAULT FALSE,
  used_by_device UUID REFERENCES devices(id) ON DELETE SET NULL,
  used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '30 days'),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_token_keys_user ON device_token_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_token_keys_key ON device_token_keys(token_key);
