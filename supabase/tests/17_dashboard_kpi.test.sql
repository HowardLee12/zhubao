begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(22);

------------------------------------------------------------------------------
-- M8 — dashboard KPIs + reports. Each metric returns numerator + denominator +
-- window + timezone (never a bare %); insufficient data reports available=false,
-- not a misleading 0%. Technicians never reach these RPCs.
--
-- This suite seeds its own deterministic KPI inputs under superuser inside the
-- test transaction so the shared seed stays stable.
------------------------------------------------------------------------------

select ok(has_function_privilege('authenticated', 'public.compute_pilot_dashboard(uuid,date,date)', 'EXECUTE'), 'authenticated may compute dashboard');
select ok(has_function_privilege('authenticated', 'public.report_funnel(uuid,date,date)', 'EXECUTE'), 'authenticated may read funnel report');
select ok(has_function_privilege('authenticated', 'public.report_retention(uuid,date,date)', 'EXECUTE'), 'authenticated may read retention report');

------------------------------------------------------------------------------
-- Seed KPI inputs (superuser; direct table writes bypass RPC gates for fixtures).
------------------------------------------------------------------------------
reset role;

-- KPI 1: give the triaged seed request a first-response (triaged_at) 2 hours after
-- creation so first-response time has a denominator >= 1.
update public.service_requests
set triaged_at = created_at + interval '2 hours'
where id = '80000000-0000-4000-8000-000000000002';

-- KPI 2 + KPI 3: status transitions on quote_versions / work_orders are guarded to
-- renoly_rls_owner (the RPC owner), so seed those under that role.
set local role renoly_rls_owner;
update public.quote_versions
set status = 'accepted'
where id = '85100000-0000-4000-8000-000000000002';
update public.work_orders
set status = 'completed', completed_at = '2026-03-01 00:00:00+00',
    completion_summary = 'done'
where id = '82000000-0000-4000-8000-000000000001';
reset role;
insert into public.work_orders (
  id, organization_id, work_order_no, customer_id, location_id, title, status,
  cancelled_at, cancellation_reason, created_at, updated_at, created_by, updated_by
) values (
  '82090000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001',
  'W-2026-9001', '40000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000001', '取消工單', 'cancelled',
  '2026-03-02 00:00:00+00', '客戶取消', '2026-03-01 00:00:00+00', '2026-03-02 00:00:00+00',
  '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001'
);

-- KPI 4: a sent revisit reminder + a revisit request created within 30 days.
insert into public.notifications (
  id, organization_id, channel, line_channel_id, customer_line_identity_id,
  template_key, template_version, payload, status, approval_status, dedupe_key,
  scheduled_at, sent_at, related_type, related_id, created_at, updated_at
) values (
  '88190000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001',
  'line', 'a1c00000-0000-4000-8000-000000000001', 'a1de0000-0000-4000-8000-000000000001',
  'maintenance_reminder', 1, '{}'::jsonb, 'sent', 'approved', 'kpi-revisit-reminder-1',
  '2026-04-01 00:00:00+00', '2026-04-01 00:00:05+00',
  'maintenance_plan', '88000000-0000-4000-8000-000000000001',
  '2026-04-01 00:00:00+00', '2026-04-01 00:00:05+00'
);
-- KPI 4 (denominator dedup): a SECOND in-window reminder for the SAME customer of
-- the SAME maintenance plan. A row-count denominator would inflate to 2; the
-- unique-customer denominator must still count this customer exactly once.
insert into public.notifications (
  id, organization_id, channel, line_channel_id, customer_line_identity_id,
  template_key, template_version, payload, status, approval_status, dedupe_key,
  scheduled_at, sent_at, related_type, related_id, created_at, updated_at
) values (
  '88190000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001',
  'line', 'a1c00000-0000-4000-8000-000000000001', 'a1de0000-0000-4000-8000-000000000001',
  'maintenance_reminder', 1, '{}'::jsonb, 'sent', 'approved', 'kpi-revisit-reminder-2',
  '2026-04-05 00:00:00+00', '2026-04-05 00:00:05+00',
  'maintenance_plan', '88000000-0000-4000-8000-000000000001',
  '2026-04-05 00:00:00+00', '2026-04-05 00:00:05+00'
);
insert into public.service_requests (
  organization_id, request_no, customer_id, location_id, asset_id, source,
  contact_name, contact_phone, subject, status, origin_maintenance_plan_id,
  created_at, updated_at, created_by, updated_by
) values (
  '20000000-0000-4000-8000-000000000001', 'R-2026-9001',
  '40000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001',
  '60000000-0000-4000-8000-000000000001', 'revisit', '示範客戶甲', '+886912345009',
  '回訪案', 'new', '88000000-0000-4000-8000-000000000001',
  '2026-04-10 00:00:00+00', '2026-04-10 00:00:00+00',
  '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001'
);

------------------------------------------------------------------------------
-- 1. KPIs return numerator + denominator + window + timezone.
------------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select set_config('test.dash', (
  public.compute_pilot_dashboard('20000000-0000-4000-8000-000000000001','2026-01-01','2026-12-31')::text
), true);

select is(
  (current_setting('test.dash')::jsonb -> 'metrics' -> 'firstResponseTime' ->> 'available'),
  'true', 'first-response time has data'
);
select is(
  (current_setting('test.dash')::jsonb -> 'metrics' -> 'firstResponseTime' ->> 'denominator'),
  '1', 'first-response denominator counts responded requests'
);
select is(
  (current_setting('test.dash')::jsonb -> 'metrics' -> 'firstResponseTime' ->> 'medianSeconds'),
  '7200', 'first-response median = 2h in seconds'
);

select is(
  (current_setting('test.dash')::jsonb -> 'metrics' -> 'quoteAcceptanceRate' ->> 'numerator'),
  '1', 'quote acceptance numerator counts accepted'
);
select is(
  (current_setting('test.dash')::jsonb -> 'metrics' -> 'quoteAcceptanceRate' ->> 'denominator'),
  '1', 'quote acceptance denominator counts sent'
);

select is(
  (current_setting('test.dash')::jsonb -> 'metrics' -> 'completionRate' ->> 'numerator'),
  '1', 'completion numerator counts completed'
);
select is(
  (current_setting('test.dash')::jsonb -> 'metrics' -> 'completionRate' ->> 'denominator'),
  '2', 'completion denominator counts completed + cancelled'
);

select is(
  (current_setting('test.dash')::jsonb -> 'metrics' -> 'revisitRate' ->> 'numerator'),
  '1', 'revisit numerator counts unique customers who revisited'
);
select is(
  (current_setting('test.dash')::jsonb -> 'metrics' -> 'revisitRate' ->> 'denominator'),
  '1', 'revisit denominator counts unique reminded customers, not reminder rows'
);
-- Two in-window reminders were seeded for the same customer/plan; a row-count
-- denominator would report 2. The denominator must dedup to 1 unique customer.
select is(
  (current_setting('test.dash')::jsonb -> 'metrics' -> 'revisitRate' ->> 'denominator'),
  '1', 'a customer with two reminders is counted once in the revisit denominator'
);
select is(
  (current_setting('test.dash')::jsonb -> 'metrics' -> 'revisitRate' ->> 'timezone'),
  'Asia/Taipei', 'revisit metric carries display timezone'
);

------------------------------------------------------------------------------
-- 2. insufficient data -> available=false, not a misleading 0%.
------------------------------------------------------------------------------
-- A window with no activity: revisit + completion have zero denominators.
select set_config('test.empty', (
  public.compute_pilot_dashboard('20000000-0000-4000-8000-000000000001','2020-01-01','2020-02-01')::text
), true);
select is(
  (current_setting('test.empty')::jsonb -> 'metrics' -> 'completionRate' ->> 'available'),
  'false', 'empty window reports completion available=false'
);
select is(
  (current_setting('test.empty')::jsonb -> 'metrics' -> 'revisitRate' ->> 'denominator'),
  '0', 'empty window revisit denominator is 0 with available=false'
);

------------------------------------------------------------------------------
-- 3. range validation.
------------------------------------------------------------------------------
select throws_ok(
  $$ select public.compute_pilot_dashboard('20000000-0000-4000-8000-000000000001','2026-12-31','2026-01-01') $$,
  '22023', 'DASHBOARD_RANGE_INVALID', 'from > to rejected'
);
select throws_ok(
  $$ select public.compute_pilot_dashboard('20000000-0000-4000-8000-000000000001','2020-01-01','2026-01-01') $$,
  '22023', 'DASHBOARD_RANGE_TOO_LARGE', 'range over 366 days rejected'
);

------------------------------------------------------------------------------
-- 4. reports + role gates. Technician cannot see KPIs; another org rejected.
------------------------------------------------------------------------------
select ok(
  (public.report_funnel('20000000-0000-4000-8000-000000000001','2026-01-01','2026-12-31') -> 'stages') ? 'completed',
  'funnel report returns stage counts'
);
select ok(
  (public.report_retention('20000000-0000-4000-8000-000000000001','2026-01-01','2026-12-31')) ? 'remindersSent',
  'retention report returns reminders-sent count'
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);
select throws_ok(
  $$ select public.compute_pilot_dashboard('20000000-0000-4000-8000-000000000001','2026-01-01','2026-12-31') $$,
  '42501', 'FORBIDDEN', 'technician cannot see the dashboard'
);
select throws_ok(
  $$ select public.report_operations('20000000-0000-4000-8000-000000000001','2026-01-01','2026-12-31') $$,
  '42501', 'FORBIDDEN', 'technician cannot read operations report'
);

select * from finish();
rollback;
