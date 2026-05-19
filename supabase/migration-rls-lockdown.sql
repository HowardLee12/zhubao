-- Migration: RLS lockdown — deny the public anon key all direct table access.
--
-- ⚠️ SEQUENCING — DO NOT RUN THIS UNTIL ALL OF THE BELOW ARE TRUE:
--   1. The code change making the server data client use service_role is
--      DEPLOYED to production.
--   2. https://zhubao.vercel.app/api/diag returns {"serviceRole":true}
--      (confirms production is really on the service_role key, not the
--       anon fallback).
--   3. The live app still works for a logged-in user.
-- If you run this while the app is on the anon key, the WHOLE app breaks
-- for every user. The staging gate above prevents that.
--
-- Why this is safe once deployed: service_role bypasses RLS, and every DB
-- access in this app is server-side via that client. Removing the permissive
-- policies only blocks the public anon key (extractable from client JS),
-- which the app no longer uses for table access.
--
-- Apply via Supabase SQL editor:
--   https://supabase.com/dashboard/project/cbqklkdllekholdiozue/sql

-- 1. Drop the "Allow all" USING(true) policies on every table.
DROP POLICY IF EXISTS "Allow all" ON public.users;
DROP POLICY IF EXISTS "Allow all" ON public.projects;
DROP POLICY IF EXISTS "Allow all" ON public.trades;
DROP POLICY IF EXISTS "Allow all" ON public.payments;
DROP POLICY IF EXISTS "Allow all" ON public.quotes;
DROP POLICY IF EXISTS "Allow all" ON public.quote_sections;
DROP POLICY IF EXISTS "Allow all" ON public.quote_items;
DROP POLICY IF EXISTS "Allow all" ON public.photos;
DROP POLICY IF EXISTS "Allow all" ON public.crews;

-- 2. Ensure RLS is enabled (it already is, but be explicit). With RLS on
--    and NO permissive policy, anon/authenticated get zero rows and all
--    writes are denied. service_role bypasses RLS entirely.
ALTER TABLE public.users          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trades         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quotes         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quote_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quote_items    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.photos         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crews          ENABLE ROW LEVEL SECURITY;

-- 3. Lock the SECURITY DEFINER helper that anon could call via RPC.
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM anon, authenticated, public;

-- 4. (defence in depth) Pin the trigger function's search_path.
ALTER FUNCTION public.update_updated_at() SET search_path = public, pg_temp;

-- ===== POST-APPLY VERIFICATION =====
-- a) App still works for a logged-in user (create/view a quote).
-- b) anon key is now denied — this should return [] or an error:
--    curl 'https://cbqklkdllekholdiozue.supabase.co/rest/v1/projects?select=id' \
--      -H "apikey: <NEXT_PUBLIC_SUPABASE_ANON_KEY>"
-- c) Remove the /api/diag route once verified.
