begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(17);

------------------------------------------------------------------------------
-- M8 — asset service history (append-only events projection) + retire (soft).
--
-- Shared seed: Alpha asset 60..0001 (customer 40..0001, location 50..0001,
-- assigned to technician A via work order 82..0001). Beta asset 60..0002.
------------------------------------------------------------------------------

select ok(has_function_privilege('authenticated', 'public.append_asset_service_event(uuid,uuid,text,text,uuid,timestamptz,timestamptz,uuid)', 'EXECUTE'), 'authenticated may append asset event');
select ok(has_function_privilege('authenticated', 'public.get_pilot_asset_history(uuid,uuid,integer)', 'EXECUTE'), 'authenticated may read asset history');
select ok(not has_function_privilege('anon', 'public.retire_asset(uuid,uuid,integer,text,timestamptz,uuid)', 'EXECUTE'), 'anon cannot retire an asset');

-- events allowlist now includes 'asset'.
select ok(
  exists (
    select 1 from pg_constraint
    where conname = 'events_aggregate_type_chk'
      and pg_get_constraintdef(oid) like '%''asset''%'
  ),
  'events_aggregate_type_chk permits asset aggregate'
);

------------------------------------------------------------------------------
-- 1. append + history projection.
------------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);

select ok(
  (public.append_asset_service_event(
    '20000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001',
    'serviced', '更換濾網並清洗', '82000000-0000-4000-8000-000000000001'
  )) ? 'eventId',
  'append returns an event id'
);
select is(
  jsonb_array_length(public.get_pilot_asset_history('20000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000001') -> 'events'),
  1, 'history projection returns the appended event'
);
select ok(
  jsonb_array_length(public.get_pilot_asset_history('20000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000001') -> 'workOrders') >= 1,
  'history merges related work-order summaries'
);

-- append validates payload.
select throws_ok(
  $$ select public.append_asset_service_event('20000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000001','serviced','') $$,
  '22023', 'ASSET_EVENT_PAYLOAD_INVALID', 'empty summary rejected'
);
select throws_ok(
  $$ select public.append_asset_service_event('20000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000001','bogus','x') $$,
  '22023', 'ASSET_EVENT_TYPE_INVALID', 'unknown event type rejected'
);

------------------------------------------------------------------------------
-- 2. append is truly append-only: events for an asset cannot be updated/deleted.
------------------------------------------------------------------------------
reset role;
select throws_like(
  $$ update public.events set payload = '{}'::jsonb where aggregate_type='asset' and aggregate_id='60000000-0000-4000-8000-000000000001' $$,
  '%', 'events are not updatable (append-only)'
);

------------------------------------------------------------------------------
-- 3. retire is a soft delete that preserves history.
------------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select is(
  (public.retire_asset('20000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000001', 2, '汰換') ->> 'status'),
  'retired', 'retire sets status=retired'
);
select is(
  jsonb_array_length(public.get_pilot_asset_history('20000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000001') -> 'events'),
  2, 'retire preserves the prior history (append + retire events)'
);
-- appending to a retired asset is rejected.
select throws_ok(
  $$ select public.append_asset_service_event('20000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000001','note','after retire') $$,
  '23514', 'ASSET_RETIRED', 'cannot append to a retired asset'
);
-- double retire rejected.
select throws_ok(
  $$ select public.retire_asset('20000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000001', 3, 'again') $$,
  '23514', 'ASSET_ALREADY_RETIRED', 'cannot retire twice'
);

------------------------------------------------------------------------------
-- 4. cross-tenant reject + role gates.
------------------------------------------------------------------------------
select throws_ok(
  $$ select public.append_asset_service_event('20000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000002','note','x') $$,
  'P0002', 'ASSET_NOT_FOUND', 'alpha cannot append to beta asset under alpha scope'
);
select throws_ok(
  $$ select public.get_pilot_asset_history('20000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000002') $$,
  'P0002', 'ASSET_NOT_FOUND', 'alpha cannot read beta asset history under alpha scope'
);
-- retire requires owner/admin: dispatcher cannot retire.
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
select throws_ok(
  $$ select public.retire_asset('20000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000001', 3, 'x') $$,
  '42501', 'ASSET_RETIRE_ROLE_REQUIRED', 'dispatcher cannot retire an asset'
);

select * from finish();
rollback;
