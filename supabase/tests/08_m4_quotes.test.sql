begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(76);

-- M4 uses two fresh, fully-bound requests so the seed quote fixtures remain
-- untouched and every lifecycle assertion is deterministic.
insert into public.service_requests (
  id, organization_id, request_no, customer_id, location_id, source, status,
  subject, description, contact_name, contact_phone, triaged_at,
  original_submission, created_by, updated_by
) values
  (
    '88040000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001', 'SR-M4-0001',
    '40000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001',
    'web', 'triaged', 'M4 冷氣清洗', '兩台冷氣清洗', '王先生', '+886912345678',
    statement_timestamp(), '{"subject":"M4 冷氣清洗"}'::jsonb,
    '10000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000002'
  ),
  (
    '88040000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000001', 'SR-M4-0002',
    '40000000-0000-4000-8000-000000000002',
    '50000000-0000-4000-8000-000000000002',
    'web', 'triaged', 'M4 防水估價', '浴室防水', '乙客戶', '+886988888888',
    statement_timestamp(), '{"subject":"M4 防水估價"}'::jsonb,
    '10000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000002'
  );

------------------------------------------------------------------------------
-- RPC boundary
------------------------------------------------------------------------------

select ok(has_function_privilege('authenticated', 'public.create_pilot_quote(uuid,uuid,integer,jsonb,text,uuid)', 'EXECUTE'), 'authenticated may create a quote through the staff RPC');
select ok(has_function_privilege('authenticated', 'public.get_pilot_quote_workspace(uuid,uuid)', 'EXECUTE'), 'authenticated may read the staff quote projection');
select ok(has_function_privilege('authenticated', 'public.get_pilot_quote_workspace_by_request(uuid,uuid)', 'EXECUTE'), 'authenticated may find the quote attached to a request');
select ok(has_function_privilege('authenticated', 'public.save_pilot_quote_draft(uuid,uuid,uuid,integer,jsonb,uuid)', 'EXECUTE'), 'authenticated may atomically save a draft');
select ok(has_function_privilege('authenticated', 'public.save_pilot_quote_draft(uuid,uuid,integer,jsonb,uuid)', 'EXECUTE'), 'authenticated may save through the canonical version resource');
select ok(has_function_privilege('authenticated', 'public.approve_and_send_pilot_quote(uuid,uuid,uuid,integer,integer,text,text,uuid)', 'EXECUTE'), 'authenticated may invoke the role-gated send RPC');
select ok(has_function_privilege('authenticated', 'public.rotate_pilot_quote_public_token(uuid,uuid,integer,text,text,uuid)', 'EXECUTE'), 'authenticated may invoke the owner-gated link rotation RPC');
select ok(has_function_privilege('authenticated', 'public.clone_pilot_quote_version(uuid,uuid,uuid,integer,text,uuid)', 'EXECUTE'), 'authenticated may clone a rejected version');
select ok(not has_function_privilege('anon', 'public.create_pilot_quote(uuid,uuid,integer,jsonb,text,uuid)', 'EXECUTE'), 'anon cannot create quotes');
select ok(not has_function_privilege('service_role', 'public.create_pilot_quote(uuid,uuid,integer,jsonb,text,uuid)', 'EXECUTE'), 'service role cannot bypass staff quote authorization');
select ok(has_function_privilege('service_role', 'public.resolve_pilot_public_quote(text)', 'EXECUTE'), 'service role may resolve a scoped public quote');
select ok(has_function_privilege('service_role', 'public.respond_pilot_public_quote(text,text,jsonb,uuid)', 'EXECUTE'), 'service role may record a scoped public decision');
select ok(has_function_privilege('service_role', 'public.consume_pilot_public_quote_rate_limit(text,text,text)', 'EXECUTE'), 'service role may consume the shared public quote budget');
select ok(not has_function_privilege('anon', 'public.consume_pilot_public_quote_rate_limit(text,text,text)', 'EXECUTE'), 'anon cannot invoke the rate limiter directly');
select ok(not has_function_privilege('authenticated', 'public.consume_pilot_public_quote_rate_limit(text,text,text)', 'EXECUTE'), 'staff cannot bypass the public quote gateway budget');
select ok(not has_table_privilege('service_role', 'private.pilot_public_quote_rate_limits', 'SELECT'), 'service role cannot inspect public rate-limit subjects');
select ok(not has_function_privilege('anon', 'public.resolve_pilot_public_quote(text)', 'EXECUTE'), 'anon cannot call the public gateway RPC directly');
select ok(not has_function_privilege('authenticated', 'public.resolve_pilot_public_quote(text)', 'EXECUTE'), 'staff sessions cannot bypass the public gateway');

------------------------------------------------------------------------------
-- Create: server totals, request transition, audit, idempotency, tenancy
------------------------------------------------------------------------------

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);

select is(
  public.create_pilot_quote(
    '20000000-0000-4000-8000-000000000001',
    '88040000-0000-4000-8000-000000000001', 1,
    '{
      "customerId":"40000000-0000-4000-8000-000000000001",
      "locationId":"50000000-0000-4000-8000-000000000001",
      "currency":"TWD",
      "title":"冷氣清洗正式報價",
      "validUntil":"2026-12-31",
      "customerNotes":"異常零件另行報價",
      "internalNotes":"成本不可外流",
      "terms":"完工後付款",
      "items":[{
        "serviceCatalogItemId":null,
        "groupName":"清洗",
        "name":"分離式冷氣清洗",
        "specification":"含基本測試",
        "unit":"台",
        "quantity":"2.000",
        "unitCostMinor":"700",
        "unitPriceMinor":"1800",
        "discountMinor":"0",
        "taxRate":"0.0500",
        "sortOrder":10
      }]
    }'::jsonb,
    'm4-create-0001', '98040000-0000-4000-8000-000000000001'
  ) -> 'quote' ->> 'status',
  'draft', 'dispatcher creates a persisted draft quote'
);

reset role;
select set_config('test.m4_quote1_id', (select id::text from public.quotes where service_request_id = '88040000-0000-4000-8000-000000000001'), true);
select set_config('test.m4_version1_id', (select latest_version_id::text from public.quotes where service_request_id = '88040000-0000-4000-8000-000000000001'), true);
select set_config('test.m4_quote1_no', (select quote_no from public.quotes where service_request_id = '88040000-0000-4000-8000-000000000001'), true);
select matches((select quote_no from public.quotes where service_request_id = '88040000-0000-4000-8000-000000000001'), '^Q-[0-9]{6}-[0-9]{6}$', 'quote gets an organization sequence number');
select is((select total_minor from public.quote_versions where quote_id = (select id from public.quotes where service_request_id = '88040000-0000-4000-8000-000000000001')), 3780::bigint, 'server recalculates quote total');
select is((select subtotal_minor from public.quote_items where quote_version_id = (select latest_version_id from public.quotes where service_request_id = '88040000-0000-4000-8000-000000000001')), 3600::bigint, 'server recalculates line subtotal');
select is((select status from public.service_requests where id = '88040000-0000-4000-8000-000000000001'), 'quoting', 'creating the draft moves the request to quoting in the same transaction');
select is((select event_type from public.events where aggregate_type = 'quote' and aggregate_id = (select id from public.quotes where service_request_id = '88040000-0000-4000-8000-000000000001') order by chain_sequence desc limit 1), 'quote.created', 'create appends a quote event');
select is((select event_type from public.events where aggregate_type = 'service_request' and aggregate_id = '88040000-0000-4000-8000-000000000001' order by chain_sequence desc limit 1), 'service_request.quoting', 'create appends the matching request event');

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
select is(
  public.get_pilot_quote_workspace_by_request(
    '20000000-0000-4000-8000-000000000001',
    '88040000-0000-4000-8000-000000000001'
  ) -> 'quote' ->> 'id',
  current_setting('test.m4_quote1_id'),
  'staff can reopen the quote directly from its service request'
);
select is(
  public.create_pilot_quote(
    '20000000-0000-4000-8000-000000000001',
    '88040000-0000-4000-8000-000000000001', 1,
    '{"customerId":"40000000-0000-4000-8000-000000000001","locationId":"50000000-0000-4000-8000-000000000001","currency":"TWD","title":"冷氣清洗正式報價","validUntil":"2026-12-31","customerNotes":"異常零件另行報價","internalNotes":"成本不可外流","terms":"完工後付款","items":[{"serviceCatalogItemId":null,"groupName":"清洗","name":"分離式冷氣清洗","specification":"含基本測試","unit":"台","quantity":"2.000","unitCostMinor":"700","unitPriceMinor":"1800","discountMinor":"0","taxRate":"0.0500","sortOrder":10}]}'::jsonb,
    'm4-create-0001', '98040000-0000-4000-8000-000000000001'
  ) -> 'quote' ->> 'id',
  current_setting('test.m4_quote1_id'),
  'create replay returns the original quote'
);
reset role;
select is((select count(*)::integer from public.quotes where service_request_id = '88040000-0000-4000-8000-000000000001'), 1, 'create replay never duplicates the quote');
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
select throws_ok(
  $$select public.create_pilot_quote(
      '20000000-0000-4000-8000-000000000001',
      '88040000-0000-4000-8000-000000000001', 2,
      '{"customerId":"40000000-0000-4000-8000-000000000001","locationId":"50000000-0000-4000-8000-000000000001","currency":"TWD","title":"different","validUntil":null,"customerNotes":"","internalNotes":"","terms":"","items":[{"serviceCatalogItemId":null,"groupName":"","name":"不同內容","specification":"","unit":"式","quantity":"1","unitCostMinor":"0","unitPriceMinor":"1","discountMinor":"0","taxRate":"0","sortOrder":0}]}'::jsonb,
      'm4-create-0001', null
    )$$,
  '22023', 'PILOT_IDEMPOTENCY_CONFLICT', 'same idempotency key cannot carry a different draft'
);
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);
select throws_ok(
  $$select public.create_pilot_quote('20000000-0000-4000-8000-000000000001', '88040000-0000-4000-8000-000000000002', 1, '{}'::jsonb, 'm4-tech-0001', null)$$,
  '42501', 'FORBIDDEN', 'technician cannot create a quote'
);
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000005', true);
select throws_ok(
  $$select public.get_pilot_quote_workspace('20000000-0000-4000-8000-000000000001', current_setting('test.m4_quote1_id')::uuid)$$,
  '42501', 'FORBIDDEN', 'another organization manager cannot read the quote'
);

------------------------------------------------------------------------------
-- Save and send: optimistic locking, owner gate, immutable snapshot, token
------------------------------------------------------------------------------

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
select is(
  public.save_pilot_quote_draft(
    '20000000-0000-4000-8000-000000000001',
    current_setting('test.m4_quote1_id')::uuid,
    current_setting('test.m4_version1_id')::uuid,
    1,
    '{"title":"更新後報價","validUntil":"2026-12-31","customerNotes":"客戶看得到","internalNotes":"只有店內看得到","terms":"完工付款","items":[{"serviceCatalogItemId":null,"groupName":"服務","name":"清洗與檢測","specification":"含測試","unit":"式","quantity":"1.500","unitCostMinor":"1000","unitPriceMinor":"2000","discountMinor":"100","taxRate":"0.0500","sortOrder":10}]}'::jsonb,
    '98040000-0000-4000-8000-000000000002'
  ) -> 'version' ->> 'totalMinor',
  '3045', 'save replaces the draft atomically and returns server totals'
);
select is((public.get_pilot_quote_workspace('20000000-0000-4000-8000-000000000001', current_setting('test.m4_quote1_id')::uuid) -> 'quote' ->> 'lockVersion')::integer, 2, 'saving increments the quote aggregate ETag once');
select throws_ok(
  $$select public.save_pilot_quote_draft(
      '20000000-0000-4000-8000-000000000001',
      current_setting('test.m4_quote1_id')::uuid,
      current_setting('test.m4_version1_id')::uuid,
      1, '{"title":"stale","validUntil":"2026-12-31","customerNotes":"","internalNotes":"","terms":"","items":[{"serviceCatalogItemId":null,"groupName":"","name":"不應覆寫","specification":"","unit":"式","quantity":"1","unitCostMinor":"0","unitPriceMinor":"1","discountMinor":"0","taxRate":"0","sortOrder":0}]}'::jsonb, null
    )$$,
  '40001', 'STALE_VERSION', 'stale draft save is rejected'
);
select throws_ok(
  $$select public.save_pilot_quote_draft(
      '20000000-0000-4000-8000-000000000001',
      current_setting('test.m4_quote1_id')::uuid,
      current_setting('test.m4_version1_id')::uuid,
      2, '{"title":"bad","status":"sent"}'::jsonb, null
    )$$,
  '22023', 'PILOT_VALIDATION_FAILED', 'draft save rejects lifecycle fields'
);
select throws_ok(
  $$select public.approve_and_send_pilot_quote(
      '20000000-0000-4000-8000-000000000001',
      current_setting('test.m4_quote1_id')::uuid,
      current_setting('test.m4_version1_id')::uuid,
      2, 2, encode(extensions.digest('m4-public-token', 'sha256'), 'hex'),
      'm4-send-0001', null
    )$$,
  '42501', 'QUOTE_SEND_ROLE_REQUIRED', 'dispatcher cannot bypass owner approval'
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select is(
  public.approve_and_send_pilot_quote(
    '20000000-0000-4000-8000-000000000001',
    current_setting('test.m4_quote1_id')::uuid,
    current_setting('test.m4_version1_id')::uuid,
    2, 2, encode(extensions.digest('m4-public-token', 'sha256'), 'hex'),
    'm4-send-0001', '98040000-0000-4000-8000-000000000003'
  ) -> 'quote' ->> 'status',
  'sent', 'owner approves and sends the exact draft'
);
select is(
  public.approve_and_send_pilot_quote(
    '20000000-0000-4000-8000-000000000001',
    current_setting('test.m4_quote1_id')::uuid,
    current_setting('test.m4_version1_id')::uuid,
    2, 2, encode(extensions.digest('m4-public-token', 'sha256'), 'hex'),
    'm4-send-0001', '98040000-0000-4000-8000-000000000003'
  ) ->> 'replayed',
  'true', 'send retry replays the lifecycle without duplicating side effects'
);
select throws_ok(
  $$select public.approve_and_send_pilot_quote(
      '20000000-0000-4000-8000-000000000001',
      current_setting('test.m4_quote1_id')::uuid,
      current_setting('test.m4_version1_id')::uuid,
      2, 2, encode(extensions.digest('different-replay-token', 'sha256'), 'hex'),
      'm4-send-0001', null
    )$$,
  '22023', 'PILOT_IDEMPOTENCY_CONFLICT',
  'send replay cannot replace the deterministic capability behind the same key'
);

reset role;
select is((select status || ':' || approval_status from public.quote_versions where quote_id = (select id from public.quotes where service_request_id = '88040000-0000-4000-8000-000000000001')), 'sent:approved', 'sent version is approved and immutable');
select is((select status from public.service_requests where id = '88040000-0000-4000-8000-000000000001'), 'quoted', 'send marks the request quoted atomically');
select is((select count(*)::integer from public.public_access_tokens where resource_type = 'quote' and resource_id = (select active_version_id from public.quotes where service_request_id = '88040000-0000-4000-8000-000000000001') and revoked_at is null), 1, 'send retry leaves exactly one active public token');
select ok(
  (select expires_at <= statement_timestamp() + interval '30 days 5 seconds'
     and expires_at > statement_timestamp() + interval '29 days'
   from public.public_access_tokens
   where resource_type = 'quote'
     and resource_id = current_setting('test.m4_version1_id')::uuid
     and revoked_at is null),
  'a far-future quote date never extends the bearer capability beyond 30 days'
);
select is((select event_type from public.events where aggregate_type = 'quote' and aggregate_id = (select id from public.quotes where service_request_id = '88040000-0000-4000-8000-000000000001') order by chain_sequence desc limit 1), 'quote.sent', 'send appends quote.sent');
select is((select event_type from public.events where aggregate_type = 'service_request' and aggregate_id = '88040000-0000-4000-8000-000000000001' order by chain_sequence desc limit 1), 'service_request.quoted', 'send appends service_request.quoted');
select throws_ok(
  $$update public.quote_versions set title = 'tampered' where quote_id = (select id from public.quotes where service_request_id = '88040000-0000-4000-8000-000000000001')$$,
  'P0001', 'QUOTE_VERSION_IMMUTABLE', 'sent version content cannot be changed'
);
select throws_ok(
  $$update public.quote_items set name = 'tampered' where quote_version_id = (select active_version_id from public.quotes where service_request_id = '88040000-0000-4000-8000-000000000001')$$,
  'P0001', 'QUOTE_VERSION_IMMUTABLE', 'sent version items cannot be changed'
);

------------------------------------------------------------------------------
-- Public read/accept: sanitized DTO, no-registration response, replay
------------------------------------------------------------------------------

set local role service_role;
select is(
  public.consume_pilot_public_quote_rate_limit(
    encode(extensions.digest('m4-public-token', 'sha256'), 'hex'),
    encode(extensions.digest('m4-view-ip', 'sha256'), 'hex'), 'view'
  ),
  'allowed', 'valid public view consumes the shared IP and token budget'
);
select is(
  public.consume_pilot_public_quote_rate_limit(
    encode(extensions.digest('wrong-rate-token', 'sha256'), 'hex'),
    encode(extensions.digest('m4-invalid-ip', 'sha256'), 'hex'), 'view'
  ),
  'invalid', 'invalid capabilities consume an IP budget without revealing a quote'
);
select is(
  (with consumed as materialized (
    select public.consume_pilot_public_quote_rate_limit(
      encode(extensions.digest('wrong-rate-token', 'sha256'), 'hex'),
      encode(extensions.digest('m4-abuse-ip', 'sha256'), 'hex'), 'view'
    ) as status
    from generate_series(1, 121) attempt
  ) select count(*) from consumed where status = 'limited'),
  1::bigint, 'IP abuse budget persists across invalid requests and blocks the 121st view'
);
select ok(not (public.resolve_pilot_public_quote(encode(extensions.digest('m4-public-token', 'sha256'), 'hex'))::text ~* 'unitCost|internalNotes|margin|organizationId|versionId'), 'public projection strips internal fields and internal UUIDs');
select is(public.resolve_pilot_public_quote(encode(extensions.digest('m4-public-token', 'sha256'), 'hex')) ->> 'quoteNo', current_setting('test.m4_quote1_no'), 'valid token reads only its quote');
select throws_ok(
  $$select public.resolve_pilot_public_quote(encode(extensions.digest('wrong-token', 'sha256'), 'hex'))$$,
  '42501', 'PUBLIC_QUOTE_LINK_INVALID', 'invalid public token does not reveal resource existence'
);
reset role;
select is((select status from public.quotes where service_request_id = '88040000-0000-4000-8000-000000000001'), 'viewed', 'first public GET records viewed without making a decision');

set local role service_role;
select is(
  public.respond_pilot_public_quote(
    encode(extensions.digest('m4-public-token', 'sha256'), 'hex'), 'm4-response-0001',
    jsonb_build_object(
      'decision', 'accept',
      'displayName', '王先生',
      'comment', '請安排週六上午'
    ), '98040000-0000-4000-8000-000000000004'
  ) ->> 'decision',
  'accept', 'customer accepts without registering'
);
reset role;
select is((select status from public.quotes where service_request_id = '88040000-0000-4000-8000-000000000001'), 'accepted', 'accept resolves the quote aggregate');
select is((select status from public.quote_versions where id = (select accepted_version_id from public.quotes where service_request_id = '88040000-0000-4000-8000-000000000001')), 'accepted', 'accept resolves the exact immutable version');
select is((select count(*)::integer from public.events where aggregate_type = 'quote' and aggregate_id = (select id from public.quotes where service_request_id = '88040000-0000-4000-8000-000000000001') and event_type = 'quote.accepted'), 1, 'accept appends one customer event');

set local role service_role;
select is(
  public.respond_pilot_public_quote(
    encode(extensions.digest('m4-public-token', 'sha256'), 'hex'), 'm4-response-0001',
    jsonb_build_object(
      'decision', 'accept',
      'displayName', '王先生',
      'comment', '請安排週六上午'
    ), '98040000-0000-4000-8000-000000000004'
  ) ->> 'replayed',
  'true', 'same response idempotency key replays the first decision'
);
reset role;
select is((select count(*)::integer from public.events where aggregate_type = 'quote' and aggregate_id = (select id from public.quotes where service_request_id = '88040000-0000-4000-8000-000000000001') and event_type = 'quote.accepted'), 1, 'response replay does not append another event');
set local role service_role;
select throws_ok(
  $$select public.respond_pilot_public_quote(
      encode(extensions.digest('m4-public-token', 'sha256'), 'hex'), 'm4-response-0002',
      jsonb_build_object(
        'decision', 'reject',
        'displayName', '王先生', 'comment', null
      ), null
    )$$,
  '23514', 'QUOTE_ALREADY_RESOLVED', 'an accepted quote cannot be changed to rejected'
);
select is(public.resolve_pilot_public_quote(encode(extensions.digest('m4-public-token', 'sha256'), 'hex')) -> 'decision' ->> 'displayName', '王先生', 'reopening the link shows the recorded decision');

------------------------------------------------------------------------------
-- Reject then clone: old version remains evidence; request returns to follow-up
------------------------------------------------------------------------------

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select public.create_pilot_quote(
  '20000000-0000-4000-8000-000000000001',
  '88040000-0000-4000-8000-000000000002', 1,
  '{"customerId":"40000000-0000-4000-8000-000000000002","locationId":"50000000-0000-4000-8000-000000000002","currency":"TWD","title":"防水工程報價","validUntil":"2026-12-31","customerNotes":"","internalNotes":"成本 5000","terms":"完工付款","items":[{"serviceCatalogItemId":null,"groupName":"防水","name":"浴室防水","specification":"局部施作","unit":"式","quantity":"1","unitCostMinor":"5000","unitPriceMinor":"9000","discountMinor":"0","taxRate":"0","sortOrder":10}]}'::jsonb,
  'm4-create-0002', null
);
reset role;
select set_config('test.m4_quote2_id', (select id::text from public.quotes where service_request_id = '88040000-0000-4000-8000-000000000002'), true);
select set_config('test.m4_version2_id', (select latest_version_id::text from public.quotes where service_request_id = '88040000-0000-4000-8000-000000000002'), true);
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select public.approve_and_send_pilot_quote(
  '20000000-0000-4000-8000-000000000001',
  current_setting('test.m4_quote2_id')::uuid,
  current_setting('test.m4_version2_id')::uuid,
  1, 2, encode(extensions.digest('m4-reject-token', 'sha256'), 'hex'),
  'm4-send-0002', null
);
select is(
  public.rotate_pilot_quote_public_token(
    '20000000-0000-4000-8000-000000000001',
    current_setting('test.m4_quote2_id')::uuid,
    2, encode(extensions.digest('m4-reject-token-rotated', 'sha256'), 'hex'),
    'm4-rotate-0001', null
  ) -> 'quote' ->> 'lockVersion',
  '3', 'owner rotates the public link and advances the aggregate ETag'
);
select is(
  public.rotate_pilot_quote_public_token(
    '20000000-0000-4000-8000-000000000001',
    current_setting('test.m4_quote2_id')::uuid,
    2, encode(extensions.digest('m4-reject-token-rotated', 'sha256'), 'hex'),
    'm4-rotate-0001', null
  ) ->> 'replayed',
  'true', 'rotation retry returns a usable replacement without another event'
);
select throws_ok(
  $$select public.rotate_pilot_quote_public_token(
      '20000000-0000-4000-8000-000000000001',
      current_setting('test.m4_quote2_id')::uuid,
      2, encode(extensions.digest('different-rotation-replay', 'sha256'), 'hex'),
      'm4-rotate-0001', null
    )$$,
  '22023', 'PILOT_IDEMPOTENCY_CONFLICT',
  'rotation replay cannot invalidate the URL already returned for the same key'
);
reset role;
set local role service_role;
select throws_ok(
  $$select public.resolve_pilot_public_quote(encode(extensions.digest('m4-reject-token', 'sha256'), 'hex'))$$,
  '42501', 'PUBLIC_QUOTE_LINK_INVALID', 'rotating a public link revokes the prior token'
);
select is(
  (select count(*)::integer from public.public_access_tokens pat
   where pat.resource_type = 'quote' and pat.revoked_at is null
     and pat.resource_id = current_setting('test.m4_version2_id')::uuid),
  1, 'rotation retry leaves exactly one active capability'
);
select is(
  public.resolve_pilot_public_quote(
    encode(extensions.digest('m4-reject-token-rotated', 'sha256'), 'hex')
  ) ->> 'status',
  'viewed', 'the rotated token resolves the same immutable version'
);
select is(
  public.respond_pilot_public_quote(
    encode(extensions.digest('m4-reject-token-rotated', 'sha256'), 'hex'), 'm4-response-0003',
    jsonb_build_object(
      'decision', 'reject',
      'displayName', '乙客戶', 'comment', '預算需要調整'
    ), null
  ) ->> 'decision',
  'reject', 'customer may reject the active quote'
);
reset role;
select is((select status from public.service_requests where id = '88040000-0000-4000-8000-000000000002'), 'quoting', 'rejection returns the request to follow-up');

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
select is(
  public.clone_pilot_quote_version(
    '20000000-0000-4000-8000-000000000001',
    current_setting('test.m4_quote2_id')::uuid,
    current_setting('test.m4_version2_id')::uuid,
    5, 'm4-clone-0001', null
  ) -> 'version' ->> 'status',
  'draft', 'dispatcher clones the rejected snapshot into an editable version'
);
select is((public.get_pilot_quote_workspace('20000000-0000-4000-8000-000000000001', current_setting('test.m4_quote2_id')::uuid) -> 'version' ->> 'versionNo')::integer, 2, 'clone creates the next version number');
reset role;
select is((select status from public.quote_versions where quote_id = (select id from public.quotes where service_request_id = '88040000-0000-4000-8000-000000000002') and version_no = 1), 'rejected', 'clone never rewrites the rejected version');
select is((select count(*)::integer from public.quote_items where quote_version_id = (select latest_version_id from public.quotes where service_request_id = '88040000-0000-4000-8000-000000000002')), 1, 'clone copies the item snapshot');
select is((select status from public.quotes where service_request_id = '88040000-0000-4000-8000-000000000002'), 'draft', 'cloned aggregate is ready for a revised send');

set local role service_role;
select is(
  (with consumed as materialized (
    select public.consume_pilot_public_quote_rate_limit(
      encode(extensions.digest('m4-reject-token-rotated', 'sha256'), 'hex'),
      encode(extensions.digest('m4-respond-ip-' || attempt::text, 'sha256'), 'hex'),
      'respond'
    ) as status
    from generate_series(1, 6) attempt
  ) select count(*) from consumed where status = 'limited'),
  1::bigint, 'token-wide response budget blocks a sixth decision attempt across IPs'
);

select * from finish();
rollback;
