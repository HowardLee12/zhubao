-- Migration: add crews table + backfill from trades.crew text
-- Apply via Supabase SQL editor: https://supabase.com/dashboard/project/cbqklkdllekholdiozue/sql

-- 1. New table -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.crews (
  id uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  role text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.crews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all" ON public.crews;
CREATE POLICY "Allow all" ON public.crews
  FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_crews_user ON public.crews(user_id);

-- 2. Add crew_id to trades (keep legacy `crew` text column for safety) --------
ALTER TABLE public.trades
  ADD COLUMN IF NOT EXISTS crew_id uuid REFERENCES public.crews(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_trades_crew ON public.trades(crew_id);

-- 3. Backfill: create one crew per distinct (user_id, crew text) --------------
INSERT INTO public.crews (user_id, name, role)
SELECT DISTINCT p.user_id, t.crew, '未分類'
FROM public.trades t
JOIN public.projects p ON p.id = t.project_id
WHERE COALESCE(t.crew, '') <> ''
  AND p.user_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.crews c
    WHERE c.user_id = p.user_id AND c.name = t.crew
  );

-- 4. Link trades.crew_id by matching (user_id, name) --------------------------
UPDATE public.trades t
SET crew_id = c.id
FROM public.crews c
JOIN public.projects p ON p.user_id = c.user_id
WHERE t.project_id = p.id
  AND t.crew = c.name
  AND t.crew_id IS NULL;
