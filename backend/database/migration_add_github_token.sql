-- =====================================================
-- Migration: Add github_access_token to users table
-- Run this in your Supabase SQL Editor
-- =====================================================

-- Add column to store the GitHub OAuth access token
-- This allows the backend to proxy AI requests using the
-- account owner's Copilot/Models access.
ALTER TABLE users ADD COLUMN IF NOT EXISTS github_access_token TEXT;

-- =====================================================
-- ✅ MIGRATION COMPLETE
-- =====================================================
