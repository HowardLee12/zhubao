begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(56);

------------------------------------------------------------------------------
-- Authenticated-only RPC surface (no base-table/service-role shortcut)
------------------------------------------------------------------------------

select ok(has_function_privilege('authenticated', 'public.get_pilot_service_request_detail(uuid,uuid)', 'EXECUTE'), 'authenticated can read a pilot request detail');
select ok(has_function_privilege('authenticated', 'public.update_pilot_service_request_summary(uuid,uuid,integer,jsonb,uuid)', 'EXECUTE'), 'authenticated can update a pilot request summary');
select ok(has_function_privilege('authenticated', 'public.list_pilot_customers(uuid,text,integer)', 'EXECUTE'), 'authenticated can list pilot customers');
select ok(has_function_privilege('authenticated', 'public.list_pilot_customer_locations(uuid,uuid)', 'EXECUTE'), 'authenticated can list pilot customer locations');
select ok(has_function_privilege('authenticated', 'public.list_pilot_customer_assets(uuid,uuid)', 'EXECUTE'), 'authenticated can list pilot customer assets');
select ok(has_function_privilege('authenticated', 'public.list_pilot_service_request_events(uuid,uuid,bigint,integer)', 'EXECUTE'), 'authenticated can list pilot request events');
select ok(has_function_privilege('authenticated', 'public.list_pilot_assignable_members(uuid)', 'EXECUTE'), 'authenticated can list assignable pilot members');
select ok(has_function_privilege('authenticated', 'public.create_pilot_customer(uuid,text,text)', 'EXECUTE'), 'authenticated can create a pilot customer');

select ok(not has_function_privilege('anon', 'public.get_pilot_service_request_detail(uuid,uuid)', 'EXECUTE'), 'anon cannot read a pilot request detail');
select ok(not has_function_privilege('anon', 'public.update_pilot_service_request_summary(uuid,uuid,integer,jsonb,uuid)', 'EXECUTE'), 'anon cannot update a pilot request summary');
select ok(not has_function_privilege('anon', 'public.list_pilot_customers(uuid,text,integer)', 'EXECUTE'), 'anon cannot list pilot customers');
select ok(not has_function_privilege('anon', 'public.list_pilot_customer_locations(uuid,uuid)', 'EXECUTE'), 'anon cannot list pilot customer locations');
select ok(not has_function_privilege('anon', 'public.list_pilot_customer_assets(uuid,uuid)', 'EXECUTE'), 'anon cannot list pilot customer assets');
select ok(not has_function_privilege('anon', 'public.list_pilot_service_request_events(uuid,uuid,bigint,integer)', 'EXECUTE'), 'anon cannot list pilot request events');
select ok(not has_function_privilege('anon', 'public.list_pilot_assignable_members(uuid)', 'EXECUTE'), 'anon cannot list assignable pilot members');
select ok(not has_function_privilege('anon', 'public.create_pilot_customer(uuid,text,text)', 'EXECUTE'), 'anon cannot create a pilot customer');
select ok(not has_function_privilege('service_role', 'public.create_pilot_customer(uuid,text,text)', 'EXECUTE'), 'service role cannot bypass the customer creation boundary');

------------------------------------------------------------------------------
-- Detail workspace: exact scoped DTO, child rows, and non-leaky tenancy
------------------------------------------------------------------------------

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);

select is(
  public.get_pilot_service_request_detail(
    '20000000-0000-4000-8000-000000000001',
    '80000000-0000-4000-8000-000000000001'
  ) -> 'request' ->> 'id',
  '80000000-0000-4000-8000-000000000001',
  'dispatcher reads the request detail'
);
select is(
  jsonb_array_length(public.get_pilot_service_request_detail(
    '20000000-0000-4000-8000-000000000001',
    '80000000-0000-4000-8000-000000000001'
  ) -> 'windows'),
  1,
  'detail includes preferred windows'
);
select ok(
  not (public.get_pilot_service_request_detail(
    '20000000-0000-4000-8000-000000000001',
    '80000000-0000-4000-8000-000000000001'
  ) -> 'request' ? 'organization_id'),
  'detail omits the internal organization column'
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);
select throws_ok(
  $$select public.get_pilot_service_request_detail(
      '20000000-0000-4000-8000-000000000001',
      '80000000-0000-4000-8000-000000000001'
    )$$,
  '42501', 'FORBIDDEN', 'technician cannot read the manager detail workspace'
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000005', true);
select throws_ok(
  $$select public.get_pilot_service_request_detail(
      '20000000-0000-4000-8000-000000000001',
      '80000000-0000-4000-8000-000000000001'
    )$$,
  '42501', 'FORBIDDEN', 'a manager cannot read another organization workspace'
);
select throws_ok(
  $$select public.get_pilot_service_request_detail(
      '20000000-0000-4000-8000-000000000002',
      '80000000-0000-4000-8000-000000000001'
    )$$,
  'P0002', 'SERVICE_REQUEST_NOT_FOUND', 'cross-tenant request ids do not leak existence'
);

------------------------------------------------------------------------------
-- Summary mutation: validated patch, optimistic lock, immutable source, audit
------------------------------------------------------------------------------

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
select is(
  public.update_pilot_service_request_summary(
    '20000000-0000-4000-8000-000000000001',
    '80000000-0000-4000-8000-000000000001',
    1,
    '{"subject":"冷氣清洗（已確認）","priority":"high"}'::jsonb,
    '91000000-0000-4000-8000-000000000001'
  ) -> 'request' ->> 'subject',
  '冷氣清洗（已確認）',
  'dispatcher updates the editable summary through the RPC'
);

reset role;
select is(
  (select subject from public.service_requests where id = '80000000-0000-4000-8000-000000000001'),
  '冷氣清洗（已確認）',
  'summary update is persisted'
);
select is(
  (select original_submission ->> 'subject' from public.service_requests where id = '80000000-0000-4000-8000-000000000001'),
  '冷氣需要清洗',
  'summary update preserves the immutable original submission'
);
select is(
  (select summary_edited_by from public.service_requests where id = '80000000-0000-4000-8000-000000000001'),
  '10000000-0000-4000-8000-000000000002'::uuid,
  'summary update stamps editor provenance'
);
select is(
  (select event_type from public.events
   where organization_id = '20000000-0000-4000-8000-000000000001'
     and aggregate_type = 'service_request'
     and aggregate_id = '80000000-0000-4000-8000-000000000001'
   order by chain_sequence desc limit 1),
  'service_request.summary_updated',
  'summary update appends an audit event'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
select throws_ok(
  $$select public.update_pilot_service_request_summary(
      '20000000-0000-4000-8000-000000000001',
      '80000000-0000-4000-8000-000000000001', 1,
      '{"subject":"stale"}'::jsonb, null
    )$$,
  '40001', 'STALE_VERSION', 'summary update rejects a stale lock version'
);
select throws_ok(
  $$select public.update_pilot_service_request_summary(
      '20000000-0000-4000-8000-000000000001',
      '80000000-0000-4000-8000-000000000001', 2,
      '{"status":"converted"}'::jsonb, null
    )$$,
  '22023', 'PILOT_VALIDATION_FAILED', 'summary update rejects non-summary fields'
);
select throws_ok(
  $$select public.update_pilot_service_request_summary(
      '20000000-0000-4000-8000-000000000001',
      '80000000-0000-4000-8000-000000000001', 2,
      '{"originalSubmission":{}}'::jsonb, null
    )$$,
  '22023', 'PILOT_VALIDATION_FAILED', 'summary update cannot target original submission'
);
select throws_ok(
  $$select public.update_pilot_service_request_summary(
      '20000000-0000-4000-8000-000000000001',
      '80000000-0000-4000-8000-000000000001', 2,
      '{"contactPhone":"not-a-phone"}'::jsonb, null
    )$$,
  '22023', 'PILOT_VALIDATION_FAILED', 'summary update validates phone at the database boundary'
);
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);
select throws_ok(
  $$select public.update_pilot_service_request_summary(
      '20000000-0000-4000-8000-000000000001',
      '80000000-0000-4000-8000-000000000001', 2,
      '{"subject":"forbidden"}'::jsonb, null
    )$$,
  '42501', 'FORBIDDEN', 'technician cannot update the summary'
);

------------------------------------------------------------------------------
-- Customer confirmation lists: literal search and customer scope
------------------------------------------------------------------------------

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
select is(jsonb_array_length(public.list_pilot_customers(
  '20000000-0000-4000-8000-000000000001', null, 20
)), 2, 'dispatcher lists only active customers in the organization');
select is(jsonb_array_length(public.list_pilot_customers(
  '20000000-0000-4000-8000-000000000001', '甲', 20
)), 1, 'customer search matches a literal name substring');
select is(jsonb_array_length(public.list_pilot_customers(
  '20000000-0000-4000-8000-000000000001', '%', 20
)), 0, 'customer search treats SQL wildcard characters literally');
select ok(
  not ((public.list_pilot_customers(
    '20000000-0000-4000-8000-000000000001', null, 1
  ) -> 0) ? 'organization_id'),
  'customer list omits the internal organization column'
);
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);
select throws_ok(
  $$select public.list_pilot_customers(
      '20000000-0000-4000-8000-000000000001', null, 20
    )$$,
  '42501', 'FORBIDDEN', 'technician cannot read the manager customer list'
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
select is(
  public.create_pilot_customer(
    '20000000-0000-4000-8000-000000000001', '  新增測試客戶  ', '+886988776655'
  ) ->> 'name',
  '新增測試客戶',
  'dispatcher creates a persisted customer with normalized input'
);
reset role;
select matches(
  (select customer_no from public.customers
   where organization_id = '20000000-0000-4000-8000-000000000001'
     and name = '新增測試客戶'),
  '^CU-[0-9]{6}-[0-9]{6}$',
  'customer creation allocates a human-readable organization sequence'
);
select is(
  (select created_by from public.customers
   where organization_id = '20000000-0000-4000-8000-000000000001'
     and name = '新增測試客戶'),
  '10000000-0000-4000-8000-000000000002'::uuid,
  'customer creation records the authenticated actor'
);
select is(
  (select event_type from public.events e
   join public.customers c on c.id = e.aggregate_id
   where e.organization_id = '20000000-0000-4000-8000-000000000001'
     and e.aggregate_type = 'customer'
     and c.name = '新增測試客戶'
   order by e.chain_sequence desc limit 1),
  'customer.created',
  'customer creation appends an audit event'
);
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
select throws_ok(
  $$select public.create_pilot_customer(
      '20000000-0000-4000-8000-000000000001', '錯誤電話', '0912345678'
    )$$,
  '22023', 'PILOT_VALIDATION_FAILED', 'customer creation validates phone at the database boundary'
);
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);
select throws_ok(
  $$select public.create_pilot_customer(
      '20000000-0000-4000-8000-000000000001', '技師不可建立', null
    )$$,
  '42501', 'FORBIDDEN', 'technician cannot create a customer'
);
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000005', true);
select throws_ok(
  $$select public.create_pilot_customer(
      '20000000-0000-4000-8000-000000000001', '跨店不可建立', null
    )$$,
  '42501', 'FORBIDDEN', 'a manager cannot create a customer in another organization'
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
select is(
  public.list_pilot_customer_locations(
    '20000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000001'
  ) -> 0 ->> 'id',
  '50000000-0000-4000-8000-000000000001',
  'location list is scoped to the selected customer'
);
select is(
  public.list_pilot_customer_assets(
    '20000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000001'
  ) -> 0 ->> 'id',
  '60000000-0000-4000-8000-000000000001',
  'asset list is scoped to the selected customer'
);
select is(
  jsonb_array_length(public.list_pilot_customer_locations(
    '20000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000003'
  )),
  0,
  'a customer id from another tenant returns no locations'
);
select is(
  jsonb_array_length(public.list_pilot_customer_assets(
    '20000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000003'
  )),
  0,
  'a customer id from another tenant returns no assets'
);

------------------------------------------------------------------------------
-- Timeline: scoped, paginated, and raw submission payload is removed in SQL
------------------------------------------------------------------------------

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
select private.append_user_event(
  '20000000-0000-4000-8000-000000000001', 'service_request',
  '80000000-0000-4000-8000-000000000001', 'service_request.test_payload',
  '{"safe":"visible","submission":{"contactPhone":"+886900000000"}}'::jsonb,
  null, null, null
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
select ok(
  not ((public.list_pilot_service_request_events(
    '20000000-0000-4000-8000-000000000001',
    '80000000-0000-4000-8000-000000000001', null, 20
  ) -> 0 -> 'payload') ? 'submission'),
  'timeline strips the raw submission copy at the database boundary'
);
select is(
  jsonb_array_length(public.list_pilot_service_request_events(
    '20000000-0000-4000-8000-000000000001',
    '80000000-0000-4000-8000-000000000001', null, 1
  )),
  1,
  'timeline honors its page limit'
);
select is(
  jsonb_array_length(public.list_pilot_service_request_events(
    '20000000-0000-4000-8000-000000000001',
    '80000000-0000-4000-8000-000000000001', 2, 20
  )),
  1,
  'timeline keyset cursor returns only older events'
);
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);
select throws_ok(
  $$select public.list_pilot_service_request_events(
      '20000000-0000-4000-8000-000000000001',
      '80000000-0000-4000-8000-000000000001', null, 20
    )$$,
  '42501', 'FORBIDDEN', 'technician cannot read the manager timeline'
);

------------------------------------------------------------------------------
-- Assignment picker: only active operational roles, manager-only
------------------------------------------------------------------------------

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
select is(
  jsonb_array_length(public.list_pilot_assignable_members(
    '20000000-0000-4000-8000-000000000001'
  )),
  4,
  'assignment picker lists the four active operational members'
);
select is(
  (select item ->> 'display_name'
   from jsonb_array_elements(public.list_pilot_assignable_members(
     '20000000-0000-4000-8000-000000000001'
   )) item
   where item ->> 'id' = '30000000-0000-4000-8000-000000000003'),
  'Alpha 技師 A',
  'assignment picker returns the technician display name'
);
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);
select throws_ok(
  $$select public.list_pilot_assignable_members(
      '20000000-0000-4000-8000-000000000001'
    )$$,
  '42501', 'FORBIDDEN', 'technician cannot enumerate organization members'
);

select * from finish();
rollback;
