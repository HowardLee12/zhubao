-- =============================================
-- Migration: Add users table + user_id to projects
-- Run this in Supabase SQL Editor
-- =============================================

-- 1. Create users table
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  line_user_id TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  picture_url TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_line_user_id ON users(line_user_id);

-- 2. Add user_id column to projects
ALTER TABLE projects ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id);
CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id);

-- 3. RLS for users table
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all" ON users FOR ALL USING (true) WITH CHECK (true);

-- 4. Auto-update trigger for users
CREATE TRIGGER users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
