-- =====================================================
-- Centralized Token Tracker - Supabase Schema
-- Run this in Supabase SQL Editor
-- =====================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =====================================================
-- DEVICES TABLE
-- Stores registered devices
-- =====================================================
CREATE TABLE IF NOT EXISTS devices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  device_name VARCHAR(100) NOT NULL,
  hardware_fingerprint VARCHAR(255) UNIQUE NOT NULL,
  device_token TEXT NOT NULL,
  is_blocked BOOLEAN DEFAULT FALSE,
  is_admin BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ DEFAULT NOW(),
  metadata JSONB DEFAULT '{}'::jsonb
);

-- Index for faster fingerprint lookups
CREATE INDEX IF NOT EXISTS idx_devices_fingerprint ON devices(hardware_fingerprint);
CREATE INDEX IF NOT EXISTS idx_devices_blocked ON devices(is_blocked);

-- =====================================================
-- TOKEN_ALLOCATIONS TABLE
-- Stores monthly token allocations per device
-- =====================================================
CREATE TABLE IF NOT EXISTS token_allocations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  allocated_tokens INTEGER DEFAULT 50,
  used_tokens INTEGER DEFAULT 0,
  month_year VARCHAR(7) NOT NULL, -- Format: 'YYYY-MM'
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(device_id, month_year)
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_allocations_device ON token_allocations(device_id);
CREATE INDEX IF NOT EXISTS idx_allocations_month ON token_allocations(month_year);

-- =====================================================
-- USAGE_LOGS TABLE
-- Detailed log of all token usage
-- =====================================================
CREATE TABLE IF NOT EXISTS usage_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  tokens_used INTEGER NOT NULL,
  model_type VARCHAR(50) NOT NULL, -- 'claude-opus-4.5', 'gpt-4', 'copilot', etc.
  request_type VARCHAR(50) DEFAULT 'completion', -- 'completion', 'chat', 'inline'
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for analytics
CREATE INDEX IF NOT EXISTS idx_usage_device ON usage_logs(device_id);
CREATE INDEX IF NOT EXISTS idx_usage_created ON usage_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_usage_model ON usage_logs(model_type);

-- =====================================================
-- ADMIN_SETTINGS TABLE
-- Global settings for the system
-- =====================================================
CREATE TABLE IF NOT EXISTS admin_settings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  setting_key VARCHAR(100) UNIQUE NOT NULL,
  setting_value TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert default settings
INSERT INTO admin_settings (setting_key, setting_value) VALUES
  ('total_monthly_budget', '300'),
  ('default_device_allocation', '50'),
  ('max_devices', '6'),
  ('current_month', TO_CHAR(NOW(), 'YYYY-MM'))
ON CONFLICT (setting_key) DO NOTHING;

-- =====================================================
-- TOKEN_TRANSFERS TABLE
-- Log of token transfers between devices
-- =====================================================
CREATE TABLE IF NOT EXISTS token_transfers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  from_device_id UUID REFERENCES devices(id) ON DELETE SET NULL,
  to_device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  tokens_transferred INTEGER NOT NULL,
  month_year VARCHAR(7) NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- HELPER FUNCTIONS
-- =====================================================

-- Function to get current month string
CREATE OR REPLACE FUNCTION get_current_month()
RETURNS VARCHAR(7) AS $$
BEGIN
  RETURN TO_CHAR(NOW(), 'YYYY-MM');
END;
$$ LANGUAGE plpgsql;

-- Function to update last_seen timestamp
CREATE OR REPLACE FUNCTION update_device_last_seen()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE devices SET last_seen_at = NOW() WHERE id = NEW.device_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update last_seen on usage
DROP TRIGGER IF EXISTS trigger_update_last_seen ON usage_logs;
CREATE TRIGGER trigger_update_last_seen
  AFTER INSERT ON usage_logs
  FOR EACH ROW
  EXECUTE FUNCTION update_device_last_seen();

-- Function to auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for token_allocations
DROP TRIGGER IF EXISTS trigger_allocations_updated ON token_allocations;
CREATE TRIGGER trigger_allocations_updated
  BEFORE UPDATE ON token_allocations
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- =====================================================
-- ROW LEVEL SECURITY (RLS) - Optional
-- Enable if you want extra security
-- =====================================================

-- ALTER TABLE devices ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE token_allocations ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE usage_logs ENABLE ROW LEVEL SECURITY;

-- =====================================================
-- VIEWS FOR EASY QUERYING
-- =====================================================

-- View: Current month device status
CREATE OR REPLACE VIEW device_status_current AS
SELECT 
  d.id,
  d.device_name,
  d.hardware_fingerprint,
  d.is_blocked,
  d.is_admin,
  d.last_seen_at,
  COALESCE(ta.allocated_tokens, 50) as allocated_tokens,
  COALESCE(ta.used_tokens, 0) as used_tokens,
  COALESCE(ta.allocated_tokens, 50) - COALESCE(ta.used_tokens, 0) as remaining_tokens,
  get_current_month() as current_month
FROM devices d
LEFT JOIN token_allocations ta ON d.id = ta.device_id AND ta.month_year = get_current_month();

-- View: Monthly summary
CREATE OR REPLACE VIEW monthly_summary AS
SELECT 
  month_year,
  COUNT(DISTINCT device_id) as active_devices,
  SUM(allocated_tokens) as total_allocated,
  SUM(used_tokens) as total_used,
  SUM(allocated_tokens) - SUM(used_tokens) as total_remaining
FROM token_allocations
GROUP BY month_year
ORDER BY month_year DESC;
