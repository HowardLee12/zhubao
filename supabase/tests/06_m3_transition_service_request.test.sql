begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

-- Covers the status-only transition_service_request primitive that M3 keeps as
-- the decline / cancel / start-quoting / mark-quoted path (convert now has its
-- own RPC). These branches previously had no direct pgTAP coverage.

select plan(12);

------------------------------------------------------------------------------
-- happy transitions
------------------------------------------------------------------------------

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);

-- start-quoting: triaged (80000002) -> quoting
select is(
  (public.transition_service_request(
    '20000000-0000-4000-8000-000000000001',
    '80000000-0000-4000-8000-000000000002', 'quoting', 1, null, null, null
  )).status,
  'quoting',
  'dispatcher starts quoting a triaged request'
);

-- mark-quoted: quoting -> quoted (80000002 has a sent quote fixture 85000002)
select is(
  (public.transition_service_request(
    '20000000-0000-4000-8000-000000000001',
    '80000000-0000-4000-8000-000000000002', 'quoted', 2, null, null, null
  )).status,
  'quoted',
  'a request with a sent quote can be marked quoted'
);

-- decline with a reason: new (80000001) -> declined
select is(
  (public.transition_service_request(
    '20000000-0000-4000-8000-000000000001',
    '80000000-0000-4000-8000-000000000001', 'declined', 1, '不在服務範圍', null, null
  )).status,
  'declined',
  'a new request can be declined with a reason'
);

reset role;
select is(
  (select decline_reason from public.service_requests
   where id = '80000000-0000-4000-8000-000000000001'),
  '不在服務範圍',
  'decline reason is persisted'
);
select is(
  (select event_type from public.events
   where organization_id = '20000000-0000-4000-8000-000000000001'
     and aggregate_type = 'service_request'
     and aggregate_id = '80000000-0000-4000-8000-000000000001'
   order by chain_sequence desc limit 1),
  'service_request.declined',
  'decline appends a service_request.declined event'
);

------------------------------------------------------------------------------
-- close-reason guards
------------------------------------------------------------------------------

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);

-- decline without a reason is rejected
select throws_ok(
  $$select public.transition_service_request(
      '20000000-0000-4000-8000-000000000001',
      '80000000-0000-4000-8000-000000000002', 'declined', 3, null, null, null
    )$$,
  '23514', 'CLOSE_REASON_REQUIRED', 'decline without a reason is rejected'
);

-- cancel without a reason is rejected
select throws_ok(
  $$select public.transition_service_request(
      '20000000-0000-4000-8000-000000000001',
      '80000000-0000-4000-8000-000000000002', 'cancelled', 3, '   ', null, null
    )$$,
  '23514', 'CLOSE_REASON_REQUIRED', 'cancel with a blank reason is rejected'
);

-- cancel with a reason succeeds (quoted -> cancelled)
select is(
  (public.transition_service_request(
    '20000000-0000-4000-8000-000000000001',
    '80000000-0000-4000-8000-000000000002', 'cancelled', 3, '客戶取消', null, null
  )).status,
  'cancelled',
  'a quoted request can be cancelled with a reason'
);

------------------------------------------------------------------------------
-- mark-quoted requires a sent quote
------------------------------------------------------------------------------

-- 80000003 is a fresh new request with no quote. Take it to quoting, then the
-- mark-quoted attempt must fail because no sent quote exists.
reset role;
insert into public.service_requests (
  id, organization_id, request_no, customer_id, location_id, source,
  contact_name, contact_email, subject, description, status,
  created_at, updated_at, created_by, updated_by
) values (
  '80000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000001',
  'R-2026-9003', '40000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000001', 'manual', '示範客戶甲',
  'customer.alpha@example.test', '沒有報價的進件', 'mark-quoted guard fixture', 'quoting',
  '2026-01-07 00:00:00+00', '2026-01-07 00:00:00+00',
  '10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
select throws_ok(
  $$select public.transition_service_request(
      '20000000-0000-4000-8000-000000000001',
      '80000000-0000-4000-8000-000000000003', 'quoted', 1, null, null, null
    )$$,
  '23514', 'QUOTED_REQUIRES_SENT_QUOTE',
  'marking quoted without a sent quote is rejected'
);

------------------------------------------------------------------------------
-- illegal jump, cross-tenant, and role guards
------------------------------------------------------------------------------

-- illegal jump: new -> quoted directly is not a legal transition
select throws_ok(
  $$select public.transition_service_request(
      '20000000-0000-4000-8000-000000000001',
      '80000000-0000-4000-8000-000000000003', 'quoting', 1, null, null, null
    )$$,
  '23514', 'INVALID_SERVICE_REQUEST_TRANSITION',
  'an illegal status jump is rejected'
);

-- cross-tenant: Beta owner cannot transition an Alpha request (no existence leak)
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000005', true);
select throws_ok(
  $$select public.transition_service_request(
      '20000000-0000-4000-8000-000000000002',
      '80000000-0000-4000-8000-000000000003', 'declined', 1, 'x', null, null
    )$$,
  'P0002', 'SERVICE_REQUEST_NOT_FOUND',
  'cross-tenant transition does not leak a request'
);

-- technician role is forbidden
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);
select throws_ok(
  $$select public.transition_service_request(
      '20000000-0000-4000-8000-000000000001',
      '80000000-0000-4000-8000-000000000003', 'declined', 1, 'x', null, null
    )$$,
  '42501', 'FORBIDDEN', 'technician cannot transition a request'
);

select * from finish();
rollback;
