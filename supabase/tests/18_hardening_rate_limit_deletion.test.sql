begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(27);

------------------------------------------------------------------------------
-- M8 — production hardening: authenticated rate limiter, pilot data deletion /
-- anonymization (org-scoped), retention cleanup.
--
-- Shared seed: Alpha org 20..0001 (owner 10..0001) with customers 40..0001/0002
-- (phones seeded), service requests 80..0001/0002. Beta org 20..0002 with
-- customer 40..0003 (phone seeded) — must remain untouched by an Alpha deletion.
------------------------------------------------------------------------------

-- Grants / boundary.
select ok(has_function_privilege('service_role', 'public.consume_pilot_authenticated_rate_limit(uuid,uuid,text,timestamptz)', 'EXECUTE'), 'service_role may consume auth rate limit');
select ok(not has_function_privilege('authenticated', 'public.consume_pilot_authenticated_rate_limit(uuid,uuid,text,timestamptz)', 'EXECUTE'), 'authenticated cannot consume rate limit directly');
select ok(has_function_privilege('authenticated', 'public.request_pilot_data_deletion(uuid,text,timestamptz,uuid)', 'EXECUTE'), 'authenticated (owner gate) may request deletion');
select ok(has_function_privilege('service_role', 'public.run_retention_cleanup(timestamptz)', 'EXECUTE'), 'service_role may run retention cleanup');
select ok(not has_function_privilege('anon', 'public.finalize_pilot_data_deletion(uuid,uuid,text,timestamptz,uuid)', 'EXECUTE'), 'anon cannot finalize deletion');

-- private support tables force RLS and expose no PostgREST grant.
select ok(
  (select relforcerowsecurity from pg_class where oid = 'private.pilot_authenticated_rate_limits'::regclass),
  'rate limit table forces RLS'
);
select ok(
  not has_table_privilege('authenticated', 'private.pilot_data_deletion_requests', 'SELECT'),
  'authenticated cannot read deletion requests table'
);

------------------------------------------------------------------------------
-- 1. rate limiter: increments; over-limit returns 'limited'; count not rolled back.
------------------------------------------------------------------------------
set local role service_role;
select is(
  public.consume_pilot_authenticated_rate_limit('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','read','2026-07-20 10:00:00+00'::timestamptz),
  'ok', 'first read is within budget'
);
-- mutation budget is lower (120); push past it deterministically in one window.
do $$
declare r text;
begin
  for i in 1..121 loop
    r := public.consume_pilot_authenticated_rate_limit(
      '20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',
      'mutation','2026-07-20 10:00:30+00'::timestamptz);
  end loop;
  perform set_config('test.rl', r, true);
end $$;
select is(current_setting('test.rl'), 'limited', 'mutation over 120/min returns limited');
-- invalid action rejected.
select throws_ok(
  $$ select public.consume_pilot_authenticated_rate_limit('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','bogus') $$,
  '22023', 'RATE_LIMIT_ACTION_INVALID', 'unknown action rejected'
);
-- separate windows are independent (a later minute resets budget).
select is(
  public.consume_pilot_authenticated_rate_limit('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','mutation','2026-07-20 10:01:30+00'::timestamptz),
  'ok', 'a new minute window resets the budget'
);
reset role;
-- the increment persisted (count reflects the over-limit calls); read as superuser.
select ok(
  (select max(request_count) from private.pilot_authenticated_rate_limits
   where organization_id='20000000-0000-4000-8000-000000000001'
     and user_id='10000000-0000-4000-8000-000000000001' and action='mutation') >= 121,
  'rate-limit increment persists (consume-before-work, no rollback)'
);

------------------------------------------------------------------------------
-- 2. data deletion: owner gate + org-scoped anonymization + confirm-once.
------------------------------------------------------------------------------
-- non-owner cannot request.
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
select throws_ok(
  format($$ select public.request_pilot_data_deletion('20000000-0000-4000-8000-000000000001','%s') $$, encode(extensions.digest('t','sha256'),'hex')),
  '42501', 'DATA_DELETION_OWNER_REQUIRED', 'dispatcher cannot request deletion'
);

-- Seed on-site location PII on an Alpha location and a Beta location so we can
-- prove the locations scrub reaches contact_name/contact_phone/lat/long/access_notes
-- AND that it is org-scoped (Beta stays intact). Superuser write (RPCs don't touch
-- these columns directly).
reset role;
update public.locations
set contact_name = '王先生', contact_phone = '+886955000111',
    latitude = 25.033964, longitude = 121.564468, access_notes = '大門密碼 8823'
where id = '50000000-0000-4000-8000-000000000001';
update public.locations
set contact_name = '陳小姐', contact_phone = '+886955000222',
    latitude = 24.147736, longitude = 120.673648, access_notes = '後門鑰匙鎖 4471'
where id = '50000000-0000-4000-8000-000000000003';

-- owner requests + finalizes.
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select set_config('test.hex', encode(extensions.digest('reauth-secret-abc','sha256'),'hex'), true);
select set_config('test.del', (
  public.request_pilot_data_deletion('20000000-0000-4000-8000-000000000001', current_setting('test.hex')) ->> 'deletionRequestId'
), true);

-- wrong re-auth token rejected.
select throws_ok(
  format($$ select public.finalize_pilot_data_deletion('20000000-0000-4000-8000-000000000001','%s','%s') $$,
    current_setting('test.del'), encode(extensions.digest('wrong-token','sha256'),'hex')),
  '42501', 'DATA_DELETION_REAUTH_INVALID', 'wrong re-auth token rejected'
);

select ok(
  (public.finalize_pilot_data_deletion('20000000-0000-4000-8000-000000000001', current_setting('test.del')::uuid, current_setting('test.hex')) ->> 'anonymizedCustomers')::int >= 2,
  'finalize anonymizes Alpha customers'
);

-- confirm-once: a replay returns replayed=true and does not re-run.
select is(
  (public.finalize_pilot_data_deletion('20000000-0000-4000-8000-000000000001', current_setting('test.del')::uuid, current_setting('test.hex')) ->> 'replayed'),
  'true', 'finalize is confirm-once (idempotent)'
);
reset role;

-- Alpha PII scrubbed.
select is(
  (select count(*)::text from public.customers
   where organization_id='20000000-0000-4000-8000-000000000001' and phone is not null),
  '0', 'Alpha customer phones scrubbed'
);
select is(
  (select count(*)::text from public.service_requests
   where organization_id='20000000-0000-4000-8000-000000000001' and contact_phone is not null),
  '0', 'Alpha request contact phones scrubbed'
);
-- transaction-necessary ids survive (rows still exist).
select ok(
  (select count(*) from public.customers where organization_id='20000000-0000-4000-8000-000000000001') >= 2,
  'customer rows (ids) preserved after anonymization'
);

-- Beta org strictly untouched (deletion scoping).
select is(
  (select phone from public.customers where id='40000000-0000-4000-8000-000000000003'),
  '+886933000003', 'Beta customer PII untouched by Alpha deletion'
);

-- FIX 1: Alpha location on-site PII fully scrubbed (contact name+phone, exact
-- geocoordinates, door/access code) — not only label/county/district/address.
select ok(
  (select contact_phone is null and latitude is null and longitude is null
     and access_notes = '' and contact_name = '已刪除'
   from public.locations where id='50000000-0000-4000-8000-000000000001'),
  'Alpha location contact_name/phone/lat/long/access_notes fully anonymized'
);
select is(
  (select address_line from public.locations where id='50000000-0000-4000-8000-000000000001'),
  '已刪除', 'Alpha location address still scrubbed (regression guard)'
);

-- Org-scoping: the Beta location PII is untouched by an Alpha deletion.
select ok(
  (select contact_name = '陳小姐' and contact_phone = '+886955000222'
     and latitude = 24.147736 and longitude = 120.673648
     and access_notes = '後門鑰匙鎖 4471'
   from public.locations where id='50000000-0000-4000-8000-000000000003'),
  'Beta location on-site PII untouched by Alpha deletion'
);

------------------------------------------------------------------------------
-- 3. retention cleanup: strips old webhook payloads, is idempotent.
------------------------------------------------------------------------------
set local role service_role;
select ok(
  (public.run_retention_cleanup('2027-01-01 00:00:00+00'::timestamptz) ->> 'strippedWebhooks')::int >= 1,
  'retention strips webhook payloads older than 90 days'
);
select is(
  (public.run_retention_cleanup('2027-01-01 00:00:00+00'::timestamptz) ->> 'strippedWebhooks'),
  '0', 'retention cleanup is idempotent (already-stripped rows not recounted)'
);
reset role;
select is(
  (select payload::text from public.line_webhook_events where id='a1eb0000-0000-4000-8000-000000000001'),
  '{}', 'old webhook payload is emptied'
);

------------------------------------------------------------------------------
-- 4. cross-tenant: an Alpha owner cannot request deletion for Beta org.
------------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select throws_ok(
  format($$ select public.request_pilot_data_deletion('20000000-0000-4000-8000-000000000002','%s') $$, encode(extensions.digest('t','sha256'),'hex')),
  '42501', 'DATA_DELETION_OWNER_REQUIRED', 'Alpha owner cannot request Beta deletion'
);

select * from finish();
rollback;
