-- =============================================
-- Migration: Add photos table for construction photo management
-- Run this in Supabase SQL Editor
-- =============================================

-- 1. Create photos table
CREATE TABLE IF NOT EXISTS photos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  trade_id UUID REFERENCES trades(id) ON DELETE SET NULL,
  user_id UUID NOT NULL,
  file_path TEXT NOT NULL,
  thumbnail_path TEXT NOT NULL,
  caption TEXT NOT NULL DEFAULT '',
  file_size INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_photos_project ON photos(project_id);
CREATE INDEX IF NOT EXISTS idx_photos_trade ON photos(trade_id);

-- 2. RLS (open for now)
ALTER TABLE photos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all" ON photos FOR ALL USING (true) WITH CHECK (true);

-- 3. Also create the Supabase Storage bucket via Dashboard:
--    Bucket name: photos
--    Public: YES
--    Max file size: 500KB
