-- Migration: add hidden_in_schedule flag to crews for visibility management
-- Apply via Supabase SQL editor: https://supabase.com/dashboard/project/cbqklkdllekholdiozue/sql

ALTER TABLE public.crews
  ADD COLUMN IF NOT EXISTS hidden_in_schedule boolean NOT NULL DEFAULT false;
