begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(39);

------------------------------------------------------------------------------
-- M8 — payment milestone tracking (create / invoice / mark-paid / waive /
-- cancel / reverse / mark-overdue / list-detail).
--
-- Shared seed: Alpha org 20..0001 (owner 10..0001, dispatcher 10..0002,
-- technician A 10..0003), project 81..0001, milestones 87..0001 (pending),
-- 87..0003 (invoiced, past due 2026-02-01). Beta org 20..0002 owns milestone
-- 87..0002 (foreign target).
------------------------------------------------------------------------------

-- Grants / boundary.
select ok(has_function_privilege('authenticated', 'public.create_payment_milestone(uuid,uuid,text,bigint,date,uuid,uuid,text,text,timestamptz,uuid)', 'EXECUTE'), 'authenticated may create milestone');
select ok(not has_function_privilege('anon', 'public.create_payment_milestone(uuid,uuid,text,bigint,date,uuid,uuid,text,text,timestamptz,uuid)', 'EXECUTE'), 'anon cannot create milestone');
select ok(has_function_privilege('service_role', 'public.mark_payments_overdue(timestamptz,integer)', 'EXECUTE'), 'service_role may run overdue worker');
select ok(not has_function_privilege('authenticated', 'public.mark_payments_overdue(timestamptz,integer)', 'EXECUTE'), 'authenticated cannot run overdue worker');

------------------------------------------------------------------------------
-- 1. create + state machine happy path (owner).
------------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);

select set_config('test.m8_pm', (
  public.create_payment_milestone(
    '20000000-0000-4000-8000-000000000001',
    '81000000-0000-4000-8000-000000000001',
    '尾款', 900000, '2026-10-01'
  ) ->> 'id'
), true);

select is(
  (public.get_pilot_payment_milestone_detail('20000000-0000-4000-8000-000000000001', current_setting('test.m8_pm')::uuid) ->> 'status'),
  'pending', 'new milestone is pending'
);
select is(
  (public.get_pilot_payment_milestone_detail('20000000-0000-4000-8000-000000000001', current_setting('test.m8_pm')::uuid) ->> 'amountMinor'),
  '900000', 'amount stored as integer minor unit'
);

select throws_ok(
  $$ select public.create_payment_milestone('20000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001','壞金額', 0) $$,
  '22023', 'PAYMENT_AMOUNT_INVALID', 'amount_minor <= 0 rejected'
);

select is(
  (public.invoice_payment_milestone('20000000-0000-4000-8000-000000000001', current_setting('test.m8_pm')::uuid, 1) ->> 'status'),
  'invoiced', 'pending -> invoiced'
);
select throws_ok(
  format($$ select public.mark_payment_milestone_paid('20000000-0000-4000-8000-000000000001','%s', 1, 'cash') $$, current_setting('test.m8_pm')),
  '40001', 'STALE_VERSION', 'stale lock_version rejected on mark-paid'
);
select is(
  (public.mark_payment_milestone_paid('20000000-0000-4000-8000-000000000001', current_setting('test.m8_pm')::uuid, 2, 'cash') ->> 'status'),
  'paid', 'invoiced -> paid'
);
select throws_ok(
  format($$ select public.invoice_payment_milestone('20000000-0000-4000-8000-000000000001','%s', 3) $$, current_setting('test.m8_pm')),
  '23514', 'PAYMENT_MILESTONE_NOT_INVOICEABLE', 'paid is terminal for invoice'
);

------------------------------------------------------------------------------
-- 2. reverse (owner/admin only, reason required, amount unchanged).
------------------------------------------------------------------------------
select throws_ok(
  format($$ select public.reverse_payment_milestone('20000000-0000-4000-8000-000000000001','%s', 3, '') $$, current_setting('test.m8_pm')),
  '22023', 'PAYMENT_REVERSE_REASON_REQUIRED', 'reverse without reason rejected'
);
select is(
  (public.reverse_payment_milestone('20000000-0000-4000-8000-000000000001', current_setting('test.m8_pm')::uuid, 3, '誤記款項') ->> 'status'),
  'invoiced', 'reverse paid -> invoiced'
);
select is(
  (public.get_pilot_payment_milestone_detail('20000000-0000-4000-8000-000000000001', current_setting('test.m8_pm')::uuid) ->> 'amountMinor'),
  '900000', 'reverse keeps amount_minor'
);

------------------------------------------------------------------------------
-- 3. sensitive-field screen -> reject (tracking only, no gateway).
------------------------------------------------------------------------------
select throws_ok(
  format($$ select public.mark_payment_milestone_paid('20000000-0000-4000-8000-000000000001','%s', 4, 'card', null, null, jsonb_build_object('card_number','4111111111111111')) $$, current_setting('test.m8_pm')),
  'RENSF', 'PAYMENT_SENSITIVE_FIELD_REJECTED', 'card number in metadata rejected'
);
select throws_ok(
  format($$ select public.mark_payment_milestone_paid('20000000-0000-4000-8000-000000000001','%s', 4, 'card', null, null, jsonb_build_object('cvv','123')) $$, current_setting('test.m8_pm')),
  'RENSF', 'PAYMENT_SENSITIVE_FIELD_REJECTED', 'cvv key in metadata rejected'
);
-- FIX 2: a card value hidden inside a NESTED object must be caught (previously
-- passed: jsonb_each_text only expanded top-level keys).
select throws_ok(
  format($$ select public.mark_payment_milestone_paid('20000000-0000-4000-8000-000000000001','%s', 4, 'card', null, null, jsonb_build_object('note', jsonb_build_object('card','4111111111111111'))) $$, current_setting('test.m8_pm')),
  'RENSF', 'PAYMENT_SENSITIVE_FIELD_REJECTED', 'nested card value in metadata rejected'
);
-- FIX 2: a PAN-shaped value inside a nested ARRAY must be caught too.
select throws_ok(
  format($$ select public.mark_payment_milestone_paid('20000000-0000-4000-8000-000000000001','%s', 4, 'card', null, null, jsonb_build_object('refs', jsonb_build_array('客戶匯款', '4111 1111 1111 1111'))) $$, current_setting('test.m8_pm')),
  'RENSF', 'PAYMENT_SENSITIVE_FIELD_REJECTED', 'PAN-shaped value in nested array rejected'
);
select is(
  (public.mark_payment_milestone_paid('20000000-0000-4000-8000-000000000001', current_setting('test.m8_pm')::uuid, 4, 'transfer', 'REF-2026-777', null, jsonb_build_object('note','客戶匯款')) ->> 'status'),
  'paid', 'clean metadata mark-paid succeeds'
);

------------------------------------------------------------------------------
-- 4. waive / cancel require reason.
------------------------------------------------------------------------------
select set_config('test.m8_pm2', (
  public.create_payment_milestone('20000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001','可作廢款', 100000) ->> 'id'
), true);
select throws_ok(
  format($$ select public.waive_payment_milestone('20000000-0000-4000-8000-000000000001','%s', 1, '') $$, current_setting('test.m8_pm2')),
  '22023', 'PAYMENT_REASON_REQUIRED', 'waive without reason rejected'
);
select is(
  (public.waive_payment_milestone('20000000-0000-4000-8000-000000000001', current_setting('test.m8_pm2')::uuid, 1, '客戶折讓') ->> 'status'),
  'waived', 'waive with reason succeeds'
);
select throws_ok(
  format($$ select public.cancel_payment_milestone('20000000-0000-4000-8000-000000000001','%s', 2, '再試') $$, current_setting('test.m8_pm2')),
  '23514', 'PAYMENT_MILESTONE_NOT_CANCELLABLE', 'waived is terminal for cancel'
);

------------------------------------------------------------------------------
-- 5. cross-tenant reject: cannot read/mutate Beta's milestone.
------------------------------------------------------------------------------
select throws_ok(
  $$ select public.get_pilot_payment_milestone_detail('20000000-0000-4000-8000-000000000001','87000000-0000-4000-8000-000000000002') $$,
  'P0002', 'PAYMENT_MILESTONE_NOT_FOUND', 'alpha cannot read beta milestone under alpha scope'
);
select throws_ok(
  $$ select public.invoice_payment_milestone('20000000-0000-4000-8000-000000000001','87000000-0000-4000-8000-000000000002', 1) $$,
  'P0002', 'PAYMENT_MILESTONE_NOT_FOUND', 'alpha cannot invoice beta milestone'
);
select throws_ok(
  $$ select public.create_payment_milestone('20000000-0000-4000-8000-000000000002','81000000-0000-4000-8000-000000000002','x', 100) $$,
  '42501', 'PAYMENT_ROLE_REQUIRED', 'alpha owner has no role in beta org'
);

------------------------------------------------------------------------------
-- 6. technician DTO carries no amounts; financial role does.
------------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);
select ok(
  not (public.get_pilot_payment_milestone_detail('20000000-0000-4000-8000-000000000001','87000000-0000-4000-8000-000000000001') ? 'amountMinor'),
  'technician detail DTO has no amountMinor'
);
select ok(
  not (public.list_pilot_payment_milestones('20000000-0000-4000-8000-000000000001') -> 'milestones' -> 0 ? 'amountMinor'),
  'technician list DTO has no amountMinor'
);
select is(
  (public.list_pilot_payment_milestones('20000000-0000-4000-8000-000000000001') ->> 'includeAmounts'),
  'false', 'technician list flags includeAmounts=false'
);
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
select ok(
  (public.list_pilot_payment_milestones('20000000-0000-4000-8000-000000000001') -> 'milestones' -> 0 ? 'amountMinor'),
  'dispatcher list DTO includes amountMinor'
);

------------------------------------------------------------------------------
-- 7. mark_payments_overdue: worker. invoiced + past org-tz due -> overdue only.
------------------------------------------------------------------------------
reset role;
set local role service_role;
select set_config('test.overdue1', (public.mark_payments_overdue('2026-07-01 00:00:00+08'::timestamptz) ->> 'markedOverdue'), true);
select ok(current_setting('test.overdue1')::int >= 1, 'at least one invoiced-past-due milestone marked overdue');
select is(
  (public.mark_payments_overdue('2026-07-01 00:00:00+08'::timestamptz) ->> 'markedOverdue'),
  '0', 'overdue worker is idempotent on replay'
);
reset role;
select is(
  (select status from public.payment_milestones where id = '87000000-0000-4000-8000-000000000003'),
  'overdue', 'the seeded invoiced past-due milestone is now overdue'
);
select is(
  (select status from public.payment_milestones where id = '87000000-0000-4000-8000-000000000001'),
  'pending', 'pending milestone never becomes overdue'
);

------------------------------------------------------------------------------
-- 8. amount integrity: table constraint forbids non-positive amount.
------------------------------------------------------------------------------
-- amount_minor > 0 is a table check constraint. Exercised under superuser since
-- authenticated has no direct table-write grant (all writes go through RPCs).
reset role;
select throws_ok(
  $$ update public.payment_milestones set amount_minor = 0 where id = '87000000-0000-4000-8000-000000000001' $$,
  '23514'
);

------------------------------------------------------------------------------
-- 9. paid is terminal against re-payment.
------------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
-- 87..0001 is still pending; mark it paid, then a second mark-paid must fail.
select is(
  (public.mark_payment_milestone_paid('20000000-0000-4000-8000-000000000001','87000000-0000-4000-8000-000000000001', 1, 'cash') ->> 'status'),
  'paid', 'pending -> paid direct'
);
select throws_ok(
  $$ select public.mark_payment_milestone_paid('20000000-0000-4000-8000-000000000001','87000000-0000-4000-8000-000000000001', 2, 'cash') $$,
  '23514', 'PAYMENT_MILESTONE_NOT_PAYABLE', 'paid milestone cannot be paid again'
);

------------------------------------------------------------------------------
-- 10. list filters + role gates.
------------------------------------------------------------------------------
select ok(
  jsonb_array_length(public.list_pilot_payment_milestones('20000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000001', 'overdue') -> 'milestones') >= 1,
  'status filter returns overdue rows'
);
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
select throws_ok(
  format($$ select public.reverse_payment_milestone('20000000-0000-4000-8000-000000000001','%s', 5, '嘗試') $$, current_setting('test.m8_pm')),
  '42501', 'PAYMENT_REVERSE_ROLE_REQUIRED', 'dispatcher cannot reverse a payment'
);
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);
select throws_ok(
  $$ select public.create_payment_milestone('20000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001','x', 100) $$,
  '42501', 'PAYMENT_ROLE_REQUIRED', 'technician cannot create milestone'
);

select * from finish();
rollback;
