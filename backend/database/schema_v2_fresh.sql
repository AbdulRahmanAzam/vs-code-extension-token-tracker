-- =====================================================
-- FRESH INSTALL - Token Tracker SaaS Schema v2.0
-- ⚠️ WARNING: This will DELETE all existing data!
-- Use migrate_v1_to_v2.sql if you want to keep old data
-- =====================================================

-- Drop existing objects
DROP VIEW IF EXISTS device_status_current CASCADE;
DROP VIEW IF EXISTS user_device_summary CASCADE;

DROP TABLE IF EXISTS token_transfers CASCADE;
DROP TABLE IF EXISTS usage_logs CASCADE;
DROP TABLE IF EXISTS token_allocations CASCADE;
DROP TABLE IF EXISTS invite_tokens CASCADE;
DROP TABLE IF EXISTS devices CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS admin_settings CASCADE;

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =====================================================
-- USERS TABLE - Registered user accounts
-- =====================================================
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash TEXT,
  display_name VARCHAR(100) NOT NULL,
  github_id VARCHAR(100) UNIQUE,
  github_username VARCHAR(100),
  avatar_url TEXT,
  github_access_token TEXT,
  role VARCHAR(20) DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  is_active BOOLEAN DEFAULT TRUE,
  max_devices INTEGER DEFAULT 3,
  monthly_token_budget INTEGER DEFAULT 50,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_login_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_github_id ON users(github_id);

-- =====================================================
-- DEVICES TABLE - User's devices
-- =====================================================
CREATE TABLE devices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_name VARCHAR(100) NOT NULL,
  hardware_fingerprint VARCHAR(255) NOT NULL,
  device_token TEXT NOT NULL,
  is_blocked BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ DEFAULT NOW(),
  metadata JSONB DEFAULT '{}'::jsonb,
  UNIQUE(user_id, hardware_fingerprint)
);

CREATE INDEX idx_devices_user ON devices(user_id);
CREATE INDEX idx_devices_fingerprint ON devices(hardware_fingerprint);

-- =====================================================
-- TOKEN_ALLOCATIONS TABLE - Monthly allocations
-- =====================================================
CREATE TABLE token_allocations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  allocated_tokens INTEGER DEFAULT 50,
  used_tokens INTEGER DEFAULT 0,
  month_year VARCHAR(7) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(device_id, month_year)
);

CREATE INDEX idx_allocations_device ON token_allocations(device_id);
CREATE INDEX idx_allocations_month ON token_allocations(month_year);

-- =====================================================
-- USAGE_LOGS TABLE - Token usage history
-- =====================================================
CREATE TABLE usage_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tokens_used INTEGER NOT NULL,
  model_type VARCHAR(50) NOT NULL,
  request_type VARCHAR(50) DEFAULT 'completion',
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_usage_device ON usage_logs(device_id);
CREATE INDEX idx_usage_user ON usage_logs(user_id);
CREATE INDEX idx_usage_created ON usage_logs(created_at);

-- =====================================================
-- INVITE_TOKENS TABLE - Registration invites
-- =====================================================
CREATE TABLE invite_tokens (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  token VARCHAR(64) UNIQUE NOT NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  used_by UUID REFERENCES users(id) ON DELETE SET NULL,
  monthly_budget INTEGER DEFAULT 50,
  max_devices INTEGER DEFAULT 3,
  note TEXT,
  is_used BOOLEAN DEFAULT FALSE,
  expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '30 days'),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  used_at TIMESTAMPTZ
);

CREATE INDEX idx_invite_token ON invite_tokens(token);

-- =====================================================
-- ADMIN_SETTINGS TABLE - Global configuration
-- =====================================================
CREATE TABLE admin_settings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  setting_key VARCHAR(100) UNIQUE NOT NULL,
  setting_value TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO admin_settings (setting_key, setting_value) VALUES
  ('total_monthly_budget', '1000'),
  ('default_user_budget', '50'),
  ('default_max_devices', '3'),
  ('allow_public_registration', 'true'),
  ('require_invite_token', 'false'),
  ('current_month', TO_CHAR(NOW(), 'YYYY-MM'));

-- =====================================================
-- TOKEN_TRANSFERS TABLE - Transfer history
-- =====================================================
CREATE TABLE token_transfers (
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

CREATE OR REPLACE FUNCTION get_current_month()
RETURNS VARCHAR(7) AS $$
BEGIN
  RETURN TO_CHAR(NOW(), 'YYYY-MM');
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION update_device_last_seen()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE devices SET last_seen_at = NOW() WHERE id = NEW.device_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_last_seen
  AFTER INSERT ON usage_logs
  FOR EACH ROW
  EXECUTE FUNCTION update_device_last_seen();

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_allocations_updated
  BEFORE UPDATE ON token_allocations
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- =====================================================
-- VIEWS
-- =====================================================

CREATE VIEW user_device_summary AS
SELECT
  u.id as user_id,
  u.email,
  u.display_name,
  u.role,
  u.is_active,
  u.monthly_token_budget,
  u.max_devices,
  COUNT(d.id) as device_count,
  COALESCE(SUM(ta.used_tokens), 0) as total_used,
  COALESCE(SUM(ta.allocated_tokens), 0) as total_allocated
FROM users u
LEFT JOIN devices d ON u.id = d.user_id
LEFT JOIN token_allocations ta ON d.id = ta.device_id AND ta.month_year = get_current_month()
GROUP BY u.id;

CREATE VIEW device_status_current AS
SELECT 
  d.id,
  d.user_id,
  d.device_name,
  d.hardware_fingerprint,
  d.is_blocked,
  d.last_seen_at,
  u.email as user_email,
  u.display_name as user_name,
  COALESCE(ta.allocated_tokens, 50) as allocated_tokens,
  COALESCE(ta.used_tokens, 0) as used_tokens,
  COALESCE(ta.allocated_tokens, 50) - COALESCE(ta.used_tokens, 0) as remaining_tokens,
  get_current_month() as current_month
FROM devices d
JOIN users u ON d.user_id = u.id
LEFT JOIN token_allocations ta ON d.id = ta.device_id AND ta.month_year = get_current_month();

-- =====================================================
-- ✅ SCHEMA INSTALLATION COMPLETE
-- =====================================================
