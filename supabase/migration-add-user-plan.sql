-- =============================================
-- Migration: Add plan column to users table
-- Run this in Supabase SQL Editor
-- =============================================

-- Add plan column with default 'free'
ALTER TABLE users ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'free';

-- Validate plan values
ALTER TABLE users ADD CONSTRAINT users_plan_check CHECK (plan IN ('free', 'pro'));
