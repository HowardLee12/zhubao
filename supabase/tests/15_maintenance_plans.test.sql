begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(30);

------------------------------------------------------------------------------
-- M8 — maintenance plans, revisit reminders (approval-gated), and one-click
-- revisit conversion.
--
-- Shared seed: Alpha plan 88..0001 (active, asset 60..0001, next_due 2026-12-01,
-- lead 14). Beta plan 88..0002 (foreign target).
------------------------------------------------------------------------------

select ok(has_function_privilege('authenticated', 'public.prepare_maintenance_reminders(uuid,uuid[],timestamptz,uuid)', 'EXECUTE'), 'authenticated may prepare reminders');
select ok(has_function_privilege('service_role', 'public.scan_maintenance_due(timestamptz,integer)', 'EXECUTE'), 'service_role may scan due plans');
select ok(not has_function_privilege('authenticated', 'public.scan_maintenance_due(timestamptz,integer)', 'EXECUTE'), 'authenticated cannot scan due plans');
select ok(has_function_privilege('authenticated', 'public.approve_notifications(uuid,uuid[],timestamptz,uuid)', 'EXECUTE'), 'authenticated may approve notifications');

------------------------------------------------------------------------------
-- 1. create + complete recomputes next_due_on in org timezone.
------------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);

select set_config('test.m8_mp', (
  public.create_maintenance_plan(
    '20000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001',
    '客廳冷氣季保養', 3, '2026-09-01'
  ) ->> 'id'
), true);
select is(
  (public.get_pilot_maintenance_plan_detail('20000000-0000-4000-8000-000000000001', current_setting('test.m8_mp')::uuid) ->> 'status'),
  'active', 'new plan is active'
);

-- complete with a completion date; next_due = completed_on + cadence months.
select is(
  (public.complete_maintenance_plan(
    '20000000-0000-4000-8000-000000000001', current_setting('test.m8_mp')::uuid, 1,
    null, '2026-09-05'
  ) ->> 'nextDueOn'),
  '2026-12-05', 'complete recomputes next_due_on = completed_on + cadence'
);
select is(
  (public.get_pilot_maintenance_plan_detail('20000000-0000-4000-8000-000000000001', current_setting('test.m8_mp')::uuid) ->> 'status'),
  'active', 'plan stays active after a completed visit'
);

-- cadence bounds enforced.
select throws_ok(
  $$ select public.create_maintenance_plan('20000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001','壞週期', 0, '2026-09-01') $$,
  '22023', 'MAINTENANCE_CADENCE_INVALID', 'cadence 0 rejected'
);

------------------------------------------------------------------------------
-- 2. pause / resume / cancel transitions + reason gate.
------------------------------------------------------------------------------
select is(
  (public.pause_maintenance_plan('20000000-0000-4000-8000-000000000001', current_setting('test.m8_mp')::uuid, 2) ->> 'status'),
  'paused', 'active -> paused'
);
select throws_ok(
  format($$ select public.complete_maintenance_plan('20000000-0000-4000-8000-000000000001','%s', 3) $$, current_setting('test.m8_mp')),
  '23514', 'MAINTENANCE_PLAN_NOT_COMPLETABLE', 'paused plan cannot be completed'
);
select is(
  (public.resume_maintenance_plan('20000000-0000-4000-8000-000000000001', current_setting('test.m8_mp')::uuid, 3) ->> 'status'),
  'active', 'paused -> active'
);
select throws_ok(
  format($$ select public.cancel_maintenance_plan('20000000-0000-4000-8000-000000000001','%s', 4, '') $$, current_setting('test.m8_mp')),
  '22023', 'MAINTENANCE_REASON_REQUIRED', 'cancel without reason rejected'
);
select is(
  (public.cancel_maintenance_plan('20000000-0000-4000-8000-000000000001', current_setting('test.m8_mp')::uuid, 4, '客戶終止') ->> 'status'),
  'cancelled', 'cancel with reason succeeds'
);
select throws_ok(
  format($$ select public.pause_maintenance_plan('20000000-0000-4000-8000-000000000001','%s', 5) $$, current_setting('test.m8_mp')),
  '23514', 'MAINTENANCE_PLAN_TRANSITION_INVALID', 'cancelled is terminal'
);

------------------------------------------------------------------------------
-- 3. reminder is a PENDING draft (human-confirm gate). Not claimable until
--    approved.
------------------------------------------------------------------------------
select is(
  (public.prepare_maintenance_reminders('20000000-0000-4000-8000-000000000001', array['88000000-0000-4000-8000-000000000001']::uuid[]) ->> 'prepared'),
  '1', 'one reminder drafted for the active seed plan'
);
reset role;
select is(
  (select approval_status from public.notifications
   where organization_id='20000000-0000-4000-8000-000000000001'
     and template_key='maintenance_reminder' and related_id='88000000-0000-4000-8000-000000000001'
   order by created_at desc limit 1),
  'pending', 'drafted reminder is approval_status=pending'
);
-- claim_notifications must NOT pick up a pending-approval reminder.
set local role service_role;
select ok(
  not exists (
    select 1 from jsonb_array_elements(public.claim_notifications('w-m8', 20)) c
    where (c ->> 'templateKey') = 'maintenance_reminder'
  ),
  'pending reminder is not claimable before approval'
);
reset role;

-- approve, then it becomes claimable.
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
reset role;
select set_config('test.notif', (
  select id::text from public.notifications
  where organization_id='20000000-0000-4000-8000-000000000001'
    and template_key='maintenance_reminder' and related_id='88000000-0000-4000-8000-000000000001'
  order by created_at desc limit 1
), true);
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select is(
  (public.approve_notifications('20000000-0000-4000-8000-000000000001', array[current_setting('test.notif')::uuid]) ->> 'approved'),
  '1', 'approve moves the pending reminder to approved'
);
reset role;
select is(
  (select approval_status from public.notifications where id = current_setting('test.notif')::uuid),
  'approved', 'reminder is now approved'
);

------------------------------------------------------------------------------
-- 4. scan_maintenance_due worker: one reminder per due plan, idempotent.
--    Alpha plan 88..0001 already has a manually-prepared reminder from section 3
--    (same dedupe key), so scan must NOT double-enqueue it — proving idempotency.
--    Beta org has no LINE recipient bound, so its due plan is skipped, not sent.
------------------------------------------------------------------------------
set local role service_role;
select is(
  (public.scan_maintenance_due('2026-12-01 00:00:00+08'::timestamptz) ->> 'enqueued'),
  '0', 'scan does not re-enqueue an already-prepared reminder (idempotent per plan+next_due_on)'
);
reset role;
-- Directly prove one-per-due-plan: exactly one maintenance_reminder row exists for
-- the Alpha plan at its current next_due_on.
select is(
  (select count(*)::text from public.notifications
   where organization_id='20000000-0000-4000-8000-000000000001'
     and template_key='maintenance_reminder' and related_id='88000000-0000-4000-8000-000000000001'),
  '1', 'exactly one reminder per due plan+date'
);

------------------------------------------------------------------------------
-- 5. one-click revisit conversion: new request source=revisit + origin linkage,
--    no old photos, forced human choice when the asset has an open request.
------------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);

-- The seed leaves service_request 80..0001 (status 'new') on asset 60..0001, so
-- the asset has an OPEN request -> conversion must require p_force.
select throws_ok(
  $$ select public.convert_maintenance_plan_to_request('20000000-0000-4000-8000-000000000001','88000000-0000-4000-8000-000000000001', 1, null, '', false) $$,
  'RENOP', 'ASSET_HAS_OPEN_REQUEST', 'open request on asset forces human choice'
);
select set_config('test.rev', (
  public.convert_maintenance_plan_to_request('20000000-0000-4000-8000-000000000001','88000000-0000-4000-8000-000000000001', 1, null, '', true) ->> 'serviceRequestId'
), true);
reset role;
select is(
  (select source from public.service_requests where id = current_setting('test.rev')::uuid),
  'revisit', 'converted request has source=revisit'
);
select is(
  (select origin_maintenance_plan_id::text from public.service_requests where id = current_setting('test.rev')::uuid),
  '88000000-0000-4000-8000-000000000001', 'converted request carries origin_maintenance_plan_id'
);
-- idempotent replay: same plan + next_due -> same request.
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select is(
  (public.convert_maintenance_plan_to_request('20000000-0000-4000-8000-000000000001','88000000-0000-4000-8000-000000000001', 1, null, '', true) ->> 'replayed'),
  'true', 'revisit conversion is idempotent per due date'
);

------------------------------------------------------------------------------
-- 6. cross-tenant + role gates.
------------------------------------------------------------------------------
select throws_ok(
  $$ select public.get_pilot_maintenance_plan_detail('20000000-0000-4000-8000-000000000001','88000000-0000-4000-8000-000000000002') $$,
  'P0002', 'MAINTENANCE_PLAN_NOT_FOUND', 'alpha cannot read beta plan under alpha scope'
);
select throws_ok(
  $$ select public.create_maintenance_plan('20000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000003','50000000-0000-4000-8000-000000000003','x', 6, '2026-12-01') $$,
  '42501', 'MAINTENANCE_ROLE_REQUIRED', 'alpha owner has no role in beta org'
);
-- technician cannot prepare reminders.
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);
select throws_ok(
  $$ select public.prepare_maintenance_reminders('20000000-0000-4000-8000-000000000001', array['88000000-0000-4000-8000-000000000001']::uuid[]) $$,
  '42501', 'MAINTENANCE_ROLE_REQUIRED', 'technician cannot prepare reminders'
);
-- technician cannot approve notifications.
select throws_ok(
  $$ select public.approve_notifications('20000000-0000-4000-8000-000000000001', array[gen_random_uuid()]) $$,
  '42501', 'NOTIFICATION_APPROVE_ROLE_REQUIRED', 'technician cannot approve notifications'
);

-- batch size guard.
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select throws_ok(
  $$ select public.approve_notifications('20000000-0000-4000-8000-000000000001', (select array_agg(gen_random_uuid()) from generate_series(1,101))) $$,
  '22023', 'NOTIFICATION_BATCH_TOO_LARGE', 'approve batch capped at 100'
);

select * from finish();
rollback;
