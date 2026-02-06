-- =====================================================
-- Migration from Schema v1 to v2 (SaaS Transformation)
-- Run this in Supabase SQL Editor
-- =====================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =====================================================
-- STEP 1: Create new USERS table
-- =====================================================
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash TEXT,
  display_name VARCHAR(100) NOT NULL,
  github_id VARCHAR(100) UNIQUE,
  github_username VARCHAR(100),
  avatar_url TEXT,
  role VARCHAR(20) DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  is_active BOOLEAN DEFAULT TRUE,
  max_devices INTEGER DEFAULT 3,
  monthly_token_budget INTEGER DEFAULT 50,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_login_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_github_id ON users(github_id);

-- =====================================================
-- STEP 2: Create default admin user
-- =====================================================
INSERT INTO users (email, password_hash, display_name, role)
VALUES (
  'admin@token-tracker.local',
  '$2b$10$abcdefghijklmnopqrstuvwxyz1234567890',  -- Placeholder, will be created on first login
  'Admin',
  'admin'
) ON CONFLICT (email) DO NOTHING;

-- =====================================================
-- STEP 3: Create default user for existing devices
-- =====================================================
DO $$
DECLARE
  default_user_id UUID;
BEGIN
  -- Create a default user for migrating existing devices
  INSERT INTO users (email, display_name, role)
  VALUES ('migrated-devices@token-tracker.local', 'Migrated User', 'user')
  ON CONFLICT (email) DO NOTHING
  RETURNING id INTO default_user_id;
  
  -- If the user already exists, get their ID
  IF default_user_id IS NULL THEN
    SELECT id INTO default_user_id FROM users WHERE email = 'migrated-devices@token-tracker.local';
  END IF;
  
  -- Store the default user ID temporarily
  PERFORM set_config('app.default_user_id', default_user_id::text, false);
END $$;

-- =====================================================
-- STEP 4: Add user_id column to devices table
-- =====================================================
DO $$
DECLARE
  default_user_id UUID;
BEGIN
  -- Get the default user ID
  SELECT id INTO default_user_id FROM users WHERE email = 'migrated-devices@token-tracker.local';
  
  -- Add user_id column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'devices' AND column_name = 'user_id'
  ) THEN
    -- Add column without NOT NULL constraint first
    ALTER TABLE devices ADD COLUMN user_id UUID;
    
    -- Set all existing devices to the default user
    UPDATE devices SET user_id = default_user_id WHERE user_id IS NULL;
    
    -- Now add NOT NULL constraint
    ALTER TABLE devices ALTER COLUMN user_id SET NOT NULL;
    
    -- Add foreign key
    ALTER TABLE devices ADD CONSTRAINT fk_devices_user 
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
    
    -- Add unique constraint on user_id + hardware_fingerprint
    ALTER TABLE devices DROP CONSTRAINT IF EXISTS unique_user_device_fingerprint;
    ALTER TABLE devices ADD CONSTRAINT unique_user_device_fingerprint 
      UNIQUE(user_id, hardware_fingerprint);
  END IF;
END $$;

-- =====================================================
-- STEP 5: Add user_id column to usage_logs table
-- =====================================================
DO $$
DECLARE
  device_user_id UUID;
BEGIN
  -- Add user_id column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'usage_logs' AND column_name = 'user_id'
  ) THEN
    -- Add column
    ALTER TABLE usage_logs ADD COLUMN user_id UUID;
    
    -- Populate user_id from device's user_id
    UPDATE usage_logs ul
    SET user_id = d.user_id
    FROM devices d
    WHERE ul.device_id = d.id AND ul.user_id IS NULL;
    
    -- Add NOT NULL constraint
    ALTER TABLE usage_logs ALTER COLUMN user_id SET NOT NULL;
    
    -- Add foreign key
    ALTER TABLE usage_logs ADD CONSTRAINT fk_usage_logs_user 
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_usage_user ON usage_logs(user_id);

-- =====================================================
-- STEP 6: Create INVITE_TOKENS table
-- =====================================================
CREATE TABLE IF NOT EXISTS invite_tokens (
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

CREATE INDEX IF NOT EXISTS idx_invite_token ON invite_tokens(token);

-- =====================================================
-- STEP 7: Update admin_settings with new defaults
-- =====================================================
INSERT INTO admin_settings (setting_key, setting_value) VALUES
  ('default_user_budget', '50'),
  ('default_max_devices', '3'),
  ('allow_public_registration', 'true'),
  ('require_invite_token', 'false')
ON CONFLICT (setting_key) DO NOTHING;

-- Update existing settings if they have old values
UPDATE admin_settings SET setting_value = '1000' 
WHERE setting_key = 'total_monthly_budget' AND setting_value::int < 1000;

-- =====================================================
-- STEP 8: Update/Create Views
-- =====================================================

DROP VIEW IF EXISTS user_device_summary;
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
LEFT JOIN token_allocations ta ON d.id = ta.device_id AND ta.month_year = TO_CHAR(NOW(), 'YYYY-MM')
GROUP BY u.id;

DROP VIEW IF EXISTS device_status_current;
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
  TO_CHAR(NOW(), 'YYYY-MM') as current_month
FROM devices d
JOIN users u ON d.user_id = u.id
LEFT JOIN token_allocations ta ON d.id = ta.device_id AND ta.month_year = TO_CHAR(NOW(), 'YYYY-MM');

-- =====================================================
-- MIGRATION COMPLETE
-- =====================================================
-- Summary:
-- ✅ Users table created
-- ✅ Devices linked to users (existing devices → default migrated user)
-- ✅ Usage logs now track user_id
-- ✅ Invite tokens system ready
-- ✅ Admin settings updated
-- ✅ Views updated for multi-user support
--
-- NEXT STEPS:
-- 1. Existing devices are assigned to 'migrated-devices@token-tracker.local'
-- 2. Admin can reassign devices to proper users via dashboard
-- 3. New users can register via extension (v2.0.0)
-- =====================================================
