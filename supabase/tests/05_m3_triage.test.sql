begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(42);

------------------------------------------------------------------------------
-- triage_service_request: happy path (new -> triaged with full binding)
------------------------------------------------------------------------------

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);

select is(
  (public.triage_service_request(
    '20000000-0000-4000-8000-000000000001',
    '80000000-0000-4000-8000-000000000001', 1,
    '40000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001',
    '60000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000003',
    'high', 'cooling', '已電話確認現場狀況'
  )).status,
  'triaged',
  'dispatcher triages a new request to triaged'
);

reset role;
select is(
  (select category from public.service_requests where id = '80000000-0000-4000-8000-000000000001'),
  'cooling',
  'triage persists the industry category'
);
select is(
  (select priority from public.service_requests where id = '80000000-0000-4000-8000-000000000001'),
  'high',
  'triage persists the priority'
);
select is(
  (select assigned_member_id from public.service_requests where id = '80000000-0000-4000-8000-000000000001'),
  '30000000-0000-4000-8000-000000000003'::uuid,
  'triage records the responsible assignee'
);
select is(
  (select internal_note from public.service_requests where id = '80000000-0000-4000-8000-000000000001'),
  '已電話確認現場狀況',
  'triage persists the staff-only internal note'
);
select isnt(
  (select triaged_at from public.service_requests where id = '80000000-0000-4000-8000-000000000001'),
  null,
  'triage stamps triaged_at'
);
select is(
  (select event_type from public.events
   where organization_id = '20000000-0000-4000-8000-000000000001'
     and aggregate_type = 'service_request'
     and aggregate_id = '80000000-0000-4000-8000-000000000001'
   order by chain_sequence desc limit 1),
  'service_request.triaged',
  'triage appends a service_request.triaged event'
);

------------------------------------------------------------------------------
-- re-triage of a triaged row is allowed (bind location/asset later)
------------------------------------------------------------------------------

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
select is(
  (public.triage_service_request(
    '20000000-0000-4000-8000-000000000001',
    '80000000-0000-4000-8000-000000000001', 2,
    '40000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001', null, null, null, null
  )).status,
  'triaged',
  're-triage of a triaged request is allowed'
);

------------------------------------------------------------------------------
-- triage negative cases
------------------------------------------------------------------------------

-- customer is mandatory
select throws_ok(
  $$select public.triage_service_request(
      '20000000-0000-4000-8000-000000000001',
      '80000000-0000-4000-8000-000000000002', 1, null
    )$$,
  '23514', 'TRIAGE_REQUIRES_CUSTOMER', 'triage without a customer is rejected'
);

-- cross-tenant customer
select throws_ok(
  $$select public.triage_service_request(
      '20000000-0000-4000-8000-000000000001',
      '80000000-0000-4000-8000-000000000002', 1,
      '40000000-0000-4000-8000-000000000003'
    )$$,
  '23503', 'CUSTOMER_NOT_IN_ORG', 'triage rejects a customer from another tenant'
);

-- location belongs to a different customer
select throws_ok(
  $$select public.triage_service_request(
      '20000000-0000-4000-8000-000000000001',
      '80000000-0000-4000-8000-000000000002', 1,
      '40000000-0000-4000-8000-000000000001',
      '50000000-0000-4000-8000-000000000002'
    )$$,
  '23503', 'LOCATION_CUSTOMER_MISMATCH', 'triage rejects a location under a different customer'
);

-- asset supplied without a location
select throws_ok(
  $$select public.triage_service_request(
      '20000000-0000-4000-8000-000000000001',
      '80000000-0000-4000-8000-000000000002', 1,
      '40000000-0000-4000-8000-000000000001', null,
      '60000000-0000-4000-8000-000000000001'
    )$$,
  '23503', 'ASSET_SCOPE_MISMATCH', 'triage rejects an asset without a bound location'
);

-- stale lock version
select throws_ok(
  $$select public.triage_service_request(
      '20000000-0000-4000-8000-000000000001',
      '80000000-0000-4000-8000-000000000002', 99,
      '40000000-0000-4000-8000-000000000001'
    )$$,
  '40001', 'STALE_VERSION', 'triage rejects a stale lock version'
);

-- active accountant/viewer roles cannot be assigned to operational work
reset role;
update public.memberships set role = 'viewer'
where id = '30000000-0000-4000-8000-000000000004';
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
select throws_ok(
  $$select public.triage_service_request(
      '20000000-0000-4000-8000-000000000001',
      '80000000-0000-4000-8000-000000000002', 1,
      '40000000-0000-4000-8000-000000000001', null, null,
      '30000000-0000-4000-8000-000000000004'
    )$$,
  '23503', 'MEMBER_NOT_ASSIGNABLE',
  'triage rejects an active non-operational member as assignee'
);

reset role;
update public.memberships set role = 'technician'
where id = '30000000-0000-4000-8000-000000000004';

-- suspended member cannot be assigned
update public.memberships set status = 'suspended', suspended_at = statement_timestamp()
where id = '30000000-0000-4000-8000-000000000004';
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
select throws_ok(
  $$select public.triage_service_request(
      '20000000-0000-4000-8000-000000000001',
      '80000000-0000-4000-8000-000000000002', 1,
      '40000000-0000-4000-8000-000000000001', null, null,
      '30000000-0000-4000-8000-000000000004'
    )$$,
  '23503', 'MEMBER_NOT_ACTIVE', 'triage rejects a suspended member as assignee'
);

-- technician role is forbidden
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);
select throws_ok(
  $$select public.triage_service_request(
      '20000000-0000-4000-8000-000000000001',
      '80000000-0000-4000-8000-000000000002', 1,
      '40000000-0000-4000-8000-000000000001'
    )$$,
  '42501', 'FORBIDDEN', 'technician cannot triage a request'
);

------------------------------------------------------------------------------
-- original_submission: write-once then immutable
------------------------------------------------------------------------------

reset role;
update public.service_requests
set original_submission = jsonb_build_object('contactName', '甲', 'subject', '原始需求')
where id = '80000000-0000-4000-8000-000000000002';

select throws_ok(
  $$update public.service_requests
    set original_submission = jsonb_build_object('contactName', '竄改', 'subject', '被改')
    where id = '80000000-0000-4000-8000-000000000002'$$,
  'P0001', 'ORIGINAL_SUBMISSION_IMMUTABLE',
  'original_submission cannot be rewritten once set'
);

-- editing the summary (subject/description) leaves original_submission intact
update public.service_requests
set subject = '編輯後的摘要主旨'
where id = '80000000-0000-4000-8000-000000000002';
select is(
  (select original_submission ->> 'subject' from public.service_requests
   where id = '80000000-0000-4000-8000-000000000002'),
  '原始需求',
  'editing the summary does not touch the original submission'
);

------------------------------------------------------------------------------
-- convert_service_request: happy path (triaged -> converted + snapshot)
------------------------------------------------------------------------------

-- SR 80000001 is triaged (lock_version 3 after the re-triage above). Point it
-- at a catalog item so the checklist snapshot has a source template.
reset role;
update public.service_requests
set metadata = jsonb_build_object('serviceCatalogItemId', '71100000-0000-4000-8000-000000000001')
where id = '80000000-0000-4000-8000-000000000001';

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);

select is(
  public.convert_service_request(
    '20000000-0000-4000-8000-000000000001',
    '80000000-0000-4000-8000-000000000001', 3, 'singleVisit'
  ) -> 'serviceRequest' ->> 'status',
  'converted',
  'convert moves a triaged request to converted'
);

reset role;
select is(
  (select status from public.service_requests where id = '80000000-0000-4000-8000-000000000001'),
  'converted',
  'converted status is persisted on the service request'
);
select is(
  (select count(*)::integer from public.work_orders
   where service_request_id = '80000000-0000-4000-8000-000000000001'),
  1,
  'convert creates exactly one work order'
);
select is(
  (select count(*)::integer from public.work_order_checklist_items wci
   join public.work_orders w on w.id = wci.work_order_id
   where w.service_request_id = '80000000-0000-4000-8000-000000000001'),
  1,
  'convert copies the checklist template items by value'
);

-- snapshot immutability: mutate the source catalog item + template, snapshot holds
update public.service_catalog_items
set name = '改名後的服務', default_price_minor = 999999
where id = '71100000-0000-4000-8000-000000000001';
update public.checklist_template_items
set label = '改名後的檢查項'
where id = '70100000-0000-4000-8000-000000000001';
select is(
  (select w.title from public.work_orders w
   where w.service_request_id = '80000000-0000-4000-8000-000000000001'),
  '分離式冷氣清洗',
  'converted work-order title is a value snapshot, not a live reference'
);
select is(
  (select wci.label from public.work_order_checklist_items wci
   join public.work_orders w on w.id = wci.work_order_id
   where w.service_request_id = '80000000-0000-4000-8000-000000000001'),
  '確認運轉正常',
  'converted checklist item label is a value snapshot'
);

------------------------------------------------------------------------------
-- convert idempotent replay: a second convert returns the existing case
------------------------------------------------------------------------------

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
select is(
  public.convert_service_request(
    '20000000-0000-4000-8000-000000000001',
    '80000000-0000-4000-8000-000000000001', 3, 'singleVisit'
  ) ->> 'replayed',
  'true',
  'converting an already-converted request replays the existing envelope'
);
reset role;
select is(
  (select count(*)::integer from public.work_orders
   where service_request_id = '80000000-0000-4000-8000-000000000001'),
  1,
  'the idempotent replay does not create a second work order'
);

------------------------------------------------------------------------------
-- convert negative cases
------------------------------------------------------------------------------

-- technician cannot convert
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);
select throws_ok(
  $$select public.convert_service_request(
      '20000000-0000-4000-8000-000000000001',
      '80000000-0000-4000-8000-000000000002', 1, 'singleVisit'
    )$$,
  '42501', 'FORBIDDEN', 'technician cannot convert a request'
);

-- stale lock version on a convertible (triaged) request
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
select throws_ok(
  $$select public.convert_service_request(
      '20000000-0000-4000-8000-000000000001',
      '80000000-0000-4000-8000-000000000002', 99, 'singleVisit'
    )$$,
  '40001', 'STALE_VERSION', 'convert rejects a stale lock version'
);

-- cross-tenant request is not found (no existence leak)
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000005', true);
select throws_ok(
  $$select public.convert_service_request(
      '20000000-0000-4000-8000-000000000002',
      '80000000-0000-4000-8000-000000000001', 4, 'singleVisit'
    )$$,
  'P0002', 'SERVICE_REQUEST_NOT_FOUND', 'convert does not leak cross-tenant requests'
);

-- convert-once unique index blocks a second target on a converted request
reset role;
select throws_ok(
  $$update public.service_requests
    set converted_work_order_id = (
      select converted_work_order_id from public.service_requests
      where id = '80000000-0000-4000-8000-000000000001'
    )
    where id = '80000000-0000-4000-8000-000000000002'$$,
  '23505', null, 'convert-once unique index forbids sharing a work-order target'
);

------------------------------------------------------------------------------
-- find_similar_customers: hint-only, tenant scoped
------------------------------------------------------------------------------

reset role;
update public.customers set phone = '+886912345678'
where id = '40000000-0000-4000-8000-000000000001';

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);

select is(
  (select match_reason from public.find_similar_customers(
    '20000000-0000-4000-8000-000000000001', '+886912345678', null, 5
  ) limit 1),
  'phone',
  'similar-customer lookup matches on phone suffix'
);
select is(
  (select customer_id from public.find_similar_customers(
    '20000000-0000-4000-8000-000000000001', null, '示範客戶甲', 5
  ) limit 1),
  '40000000-0000-4000-8000-000000000001'::uuid,
  'similar-customer lookup matches on name'
);
select is(
  (select count(*)::integer from public.find_similar_customers(
    '20000000-0000-4000-8000-000000000001', null, '%', 5
  )),
  0,
  'similar-customer lookup treats SQL wildcard characters literally'
);
select throws_ok(
  $$select * from public.find_similar_customers(
      '20000000-0000-4000-8000-000000000001', null, repeat('x', 201), 5
    )$$,
  '22023', 'PILOT_VALIDATION_FAILED',
  'similar-customer lookup validates direct RPC input bounds'
);
select is(
  (select count(*)::integer from public.find_similar_customers(
    '20000000-0000-4000-8000-000000000001', null, null, 5
  )),
  0,
  'similar-customer lookup with no criteria returns nothing'
);

-- cross-tenant isolation: Beta owner cannot see Alpha customers
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000005', true);
select is(
  (select count(*)::integer from public.find_similar_customers(
    '20000000-0000-4000-8000-000000000002', '+886912345678', '示範客戶甲', 5
  )),
  0,
  'similar-customer lookup is tenant scoped'
);

-- technician is forbidden from the hint lookup
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);
select throws_ok(
  $$select * from public.find_similar_customers(
      '20000000-0000-4000-8000-000000000001', '+886912345678', null, 5
    )$$,
  '42501', 'FORBIDDEN', 'technician cannot run the similar-customer hint'
);

------------------------------------------------------------------------------
-- keyset inbox pagination: deep paging never skips a row
------------------------------------------------------------------------------

reset role;
-- Insert 120 additional new requests so paging must walk multiple pages.
insert into public.service_requests (
  organization_id, request_no, customer_id, location_id, source,
  contact_name, contact_email, subject, description, status,
  created_at, updated_at, created_by, updated_by
)
select
  '20000000-0000-4000-8000-000000000001',
  'R-KS-' || lpad(g::text, 4, '0'),
  '40000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000001',
  'manual', '分頁測試', 'keyset@example.test',
  'keyset row ' || g, 'keyset pagination fixture', 'new',
  timestamptz '2026-02-01 00:00:00+00' + (g || ' seconds')::interval,
  timestamptz '2026-02-01 00:00:00+00' + (g || ' seconds')::interval,
  '10000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000002'
from generate_series(1, 120) g;

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);

-- Walk the whole 'new' inbox in pages of 50 and count distinct ids seen.
do $$
declare
  v_cursor_created timestamptz := null;
  v_cursor_id uuid := null;
  v_page jsonb;
  v_items jsonb;
  v_len integer;
  v_total integer := 0;
  v_last jsonb;
begin
  create temporary table _seen_ids (id uuid) on commit drop;
  loop
    v_page := public.list_pilot_service_requests(
      '20000000-0000-4000-8000-000000000001', 'new',
      v_cursor_created, v_cursor_id, 50
    );
    v_items := v_page -> 'items';
    v_len := jsonb_array_length(v_items);
    exit when v_len = 0;
    insert into _seen_ids (id)
    select (elem ->> 'id')::uuid from jsonb_array_elements(v_items) elem;
    v_total := v_total + v_len;
    v_last := v_items -> (v_len - 1);
    v_cursor_created := (v_last ->> 'createdAt')::timestamptz;
    v_cursor_id := (v_last ->> 'id')::uuid;
    exit when v_len < 50;
  end loop;
  perform set_config('renoly.test.keyset_total', v_total::text, true);
  perform set_config(
    'renoly.test.keyset_distinct',
    (select count(distinct id)::text from _seen_ids), true
  );
end $$;

reset role;
select is(
  current_setting('renoly.test.keyset_total')::integer,
  current_setting('renoly.test.keyset_distinct')::integer,
  'keyset paging never returns a duplicate row'
);
select is(
  current_setting('renoly.test.keyset_distinct')::integer,
  (select count(*)::integer from public.service_requests
   where organization_id = '20000000-0000-4000-8000-000000000001' and status = 'new'),
  'keyset paging walks every new request exactly once'
);

-- status filter is pushed into SQL: converted requests are excluded from 'new'
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select ok(
  not exists (
    select 1
    from jsonb_array_elements(
      public.list_pilot_service_requests(
        '20000000-0000-4000-8000-000000000001', 'new', null, null, 100
      ) -> 'items'
    ) elem
    where elem ->> 'status' <> 'new'
  ),
  'status filter is applied inside the keyset query'
);

-- Beta owner cannot read the Alpha inbox through the keyset overload
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000005', true);
select throws_ok(
  $$select public.list_pilot_service_requests(
      '20000000-0000-4000-8000-000000000001', null, null, null, 50
    )$$,
  '42501', 'FORBIDDEN', 'keyset overload enforces tenant membership'
);

-- the legacy (uuid, integer) overload is still callable (pin preserved)
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select ok(
  public.list_pilot_service_requests(
    '20000000-0000-4000-8000-000000000001', 25
  ) ? 'items',
  'legacy list overload remains intact'
);

select * from finish();
rollback;
