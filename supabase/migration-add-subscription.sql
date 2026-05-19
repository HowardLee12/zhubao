-- Migration: subscription tracking columns on users (ECPay 定期定額)
-- Apply via Supabase SQL editor: https://supabase.com/dashboard/project/cbqklkdllekholdiozue/sql

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS plan_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS ecpay_trade_no text;

-- plan_expires_at: when the current paid period ends. NULL = no active sub.
--   Each successful ECPay period payment pushes this ~1 month forward.
--   A user is "pro" if users.plan = 'pro' AND (plan_expires_at IS NULL OR plan_expires_at > now()).
-- ecpay_trade_no: the MerchantTradeNo of the latest checkout, for reconciliation.

CREATE INDEX IF NOT EXISTS idx_users_ecpay_trade_no ON public.users(ecpay_trade_no);
