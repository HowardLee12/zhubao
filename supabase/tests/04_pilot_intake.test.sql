begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(61);

-- RPC grants are the public database boundary: staff calls carry the real user
-- JWT, while unauthenticated intake calls are made only by the trusted API.
select ok(
  has_function_privilege(
    'authenticated',
    'public.create_pilot_organization(text,text,text,text,text,text,text,text)',
    'EXECUTE'
  ),
  'authenticated users can create a pilot organization'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.create_pilot_organization(text,text,text,text,text,text,text,text)',
    'EXECUTE'
  ),
  'anonymous users cannot create an organization'
);
select ok(
  has_function_privilege('authenticated', 'public.get_pilot_session()', 'EXECUTE'),
  'authenticated users can resolve their pilot session'
);
select ok(
  has_function_privilege(
    'authenticated', 'public.list_pilot_service_requests(uuid,integer)', 'EXECUTE'
  ),
  'authenticated managers can call the inbox RPC'
);
select ok(
  has_function_privilege(
    'authenticated', 'public.update_pilot_organization_settings(uuid,jsonb,integer)', 'EXECUTE'
  ),
  'authenticated owners can call the settings RPC'
);
select ok(
  has_function_privilege(
    'authenticated', 'public.rotate_pilot_intake_token(uuid,text,text)', 'EXECUTE'
  ),
  'authenticated owners can rotate the intake token'
);
select ok(
  has_function_privilege(
    'service_role', 'public.resolve_pilot_intake_config(text)', 'EXECUTE'
  ),
  'trusted API can resolve public intake configuration'
);
select ok(
  not has_function_privilege(
    'authenticated', 'public.resolve_pilot_intake_config(text)', 'EXECUTE'
  ),
  'staff sessions cannot invoke the public capability-token RPC'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.create_pilot_intake_upload(text,uuid,text,text,text,bigint,text)',
    'EXECUTE'
  ),
  'trusted API can create a public intake upload reservation'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.create_pilot_intake_upload(text,uuid,text,text,text,bigint,text)',
    'EXECUTE'
  ),
  'staff sessions cannot mint public upload reservations'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.complete_pilot_intake_upload(text,uuid,uuid,text,bigint,text,integer,integer)',
    'EXECUTE'
  ),
  'trusted API can finalize a verified public upload'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.get_pilot_intake_upload_verification(text,uuid,uuid)',
    'EXECUTE'
  ),
  'trusted API can resolve private object verification metadata'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.submit_pilot_service_request(text,uuid,text,text,jsonb,uuid[])',
    'EXECUTE'
  ),
  'trusted API can atomically submit a public request'
);
select ok(
  not has_table_privilege('authenticated', 'private.pilot_intake_uploads', 'SELECT'),
  'authenticated clients cannot inspect temporary public uploads'
);
select ok(
  not has_table_privilege('service_role', 'private.pilot_intake_uploads', 'SELECT'),
  'service role reaches temporary uploads only through allowlisted RPCs'
);
select ok(
  exists (
    select 1 from storage.buckets
    where id = 'v2-intake-photos'
      and public is false
      and file_size_limit = 10485760
  ),
  'public intake photos use a private size-limited storage bucket'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select set_config(
  'renoly.test.pilot_create_response',
  public.create_pilot_organization(
    'Gamma 水電工程', 'gamma-pilot', 'plumbing', 'Asia/Taipei', 'TWD',
    'Gamma 老闆', encode(extensions.digest('gamma-intake-token', 'sha256'), 'hex'),
    'gamma-org-idempotency-1'
  )::text,
  true
);
select set_config(
  'renoly.test.gamma_org',
  current_setting('renoly.test.pilot_create_response')::jsonb #>> '{organization,id}',
  true
);

select ok(
  current_setting('renoly.test.pilot_create_response')::jsonb ? 'organization'
  and current_setting('renoly.test.pilot_create_response')::jsonb ? 'membership'
  and not (current_setting('renoly.test.pilot_create_response') ~* 'token|hash|cost'),
  'organization creation returns only the agreed sanitized contract'
);

reset role;
select is(
  (
    select count(*)::integer from public.memberships
    where organization_id = current_setting('renoly.test.gamma_org')::uuid
      and user_id = '10000000-0000-4000-8000-000000000001'
      and role = 'owner' and status = 'active' and joined_at is not null
  ),
  1,
  'organization creation atomically creates its active owner membership'
);
select is(
  (
    select count(*)::integer from public.service_catalogs
    where organization_id = current_setting('renoly.test.gamma_org')::uuid
      and is_default and is_active and industry_template = 'plumbing'
  ),
  1,
  'organization creation installs one default template catalog'
);
select is(
  (
    select count(*)::integer from public.service_catalog_items
    where organization_id = current_setting('renoly.test.gamma_org')::uuid and is_active
  ),
  3,
  'organization creation installs three useful template services'
);
select ok(
  exists (
    select 1 from public.public_access_tokens
    where organization_id = current_setting('renoly.test.gamma_org')::uuid
      and resource_type = 'intake_form'
      and scopes @> array['intake:create', 'intake:upload']::text[]
      and expires_at between statement_timestamp() + interval '364 days'
                         and statement_timestamp() + interval '366 days'
      and revoked_at is null and token_hash = extensions.digest('gamma-intake-token', 'sha256')
  ),
  'organization creation installs a 365-day hashed public intake capability'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select ok(
  (
    with session as (select public.get_pilot_session() as value)
    select jsonb_path_exists(value, '$.memberships[*] ? (@.organizationSlug == "gamma-pilot")')
      and value ? 'activeOrganizationId'
      and not (value::text ~* 'token|hash|cost|settings')
    from session
  ),
  'session RPC returns only active sanitized membership summaries'
);
select is(
  public.update_pilot_organization_settings(
    current_setting('renoly.test.gamma_org')::uuid,
    '{"intakeHeadline":"歡迎預約水電服務","privacyNotice":"僅供本次聯絡使用"}'::jsonb,
    1
  ) ->> 'intakeHeadline',
  '歡迎預約水電服務',
  'owner can update allowlisted onboarding settings with optimistic locking'
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000005', true);
select throws_ok(
  format(
    'select public.update_pilot_organization_settings(%L::uuid, %L::jsonb, 2)',
    current_setting('renoly.test.gamma_org'), '{"intakeHeadline":"惡意修改"}'
  ),
  '42501', 'FORBIDDEN', 'another tenant owner cannot update Gamma settings'
);
select throws_ok(
  $$select public.list_pilot_service_requests(
      '20000000-0000-4000-8000-000000000001'::uuid, 25
    )$$,
  '42501', 'FORBIDDEN', 'Beta owner cannot read Alpha inbox'
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select ok(
  not (
    public.rotate_pilot_intake_token(
      current_setting('renoly.test.gamma_org')::uuid,
      encode(extensions.digest('gamma-rotated-token', 'sha256'), 'hex'),
      'gamma-rotate-idempotency-1'
    )::text ~* 'tokenHash|hashHex'
  ),
  'token rotation never returns a stored token hash'
);

reset role;
select ok(
  (
    select count(*) = 1 and bool_and(revoked_at is not null)
    from public.public_access_tokens
    where organization_id = current_setting('renoly.test.gamma_org')::uuid
      and token_hash = extensions.digest('gamma-intake-token', 'sha256')
  )
  and exists (
    select 1 from public.public_access_tokens
    where organization_id = current_setting('renoly.test.gamma_org')::uuid
      and token_hash = extensions.digest('gamma-rotated-token', 'sha256')
      and revoked_at is null
  ),
  'rotation revokes the old capability and creates one active replacement'
);

-- Test-only public capabilities for existing deterministic tenants.
insert into public.public_access_tokens (
  organization_id, resource_type, resource_id, token_hash, scopes,
  created_at, expires_at, revoked_at
) values
  (
    '20000000-0000-4000-8000-000000000001', 'intake_form',
    '20000000-0000-4000-8000-000000000001',
    extensions.digest('alpha-valid-intake', 'sha256'),
    array['intake:create', 'intake:upload'], statement_timestamp(),
    statement_timestamp() + interval '365 days', null
  ),
  (
    '20000000-0000-4000-8000-000000000002', 'intake_form',
    '20000000-0000-4000-8000-000000000002',
    extensions.digest('beta-valid-intake', 'sha256'),
    array['intake:create', 'intake:upload'], statement_timestamp(),
    statement_timestamp() + interval '365 days', null
  ),
  (
    '20000000-0000-4000-8000-000000000001', 'intake_form',
    '20000000-0000-4000-8000-000000000001',
    extensions.digest('alpha-expired-intake', 'sha256'),
    array['intake:create'], statement_timestamp() - interval '2 days',
    statement_timestamp() - interval '1 day', null
  ),
  (
    '20000000-0000-4000-8000-000000000001', 'intake_form',
    '20000000-0000-4000-8000-000000000001',
    extensions.digest('alpha-revoked-intake', 'sha256'),
    array['intake:create'], statement_timestamp() - interval '1 day',
    statement_timestamp() + interval '30 days', statement_timestamp()
  );

set local role service_role;
select throws_ok(
  $$select public.resolve_pilot_intake_config(repeat('0', 64))$$,
  '42501', 'PILOT_PUBLIC_LINK_NOT_FOUND', 'unknown capability is rejected'
);
select throws_ok(
  format(
    'select public.resolve_pilot_intake_config(%L)',
    encode(extensions.digest('alpha-expired-intake', 'sha256'), 'hex')
  ),
  '42501', 'PILOT_PUBLIC_LINK_NOT_FOUND', 'expired capability is rejected'
);
select throws_ok(
  format(
    'select public.resolve_pilot_intake_config(%L)',
    encode(extensions.digest('alpha-revoked-intake', 'sha256'), 'hex')
  ),
  '42501', 'PILOT_PUBLIC_LINK_NOT_FOUND', 'revoked capability is rejected'
);
select ok(
  (
    with config as (
      select public.resolve_pilot_intake_config(
        encode(extensions.digest('alpha-valid-intake', 'sha256'), 'hex')
      ) as value
    )
    select value ->> 'merchantName' = 'Alpha 冷氣水電（測試）'
      and jsonb_array_length(value -> 'serviceCatalogItems') = 2
      and not (value::text ~* 'token|hash|defaultCost|settings|phone')
    from config
  ),
  'valid capability resolves only public merchant and service-item fields'
);
select ok(
  (
    with config as (
      select public.resolve_pilot_intake_config(
        encode(extensions.digest('alpha-valid-intake', 'sha256'), 'hex')
      ) as value
    )
    select value ?& array['merchantName', 'headline', 'privacyNotice', 'serviceCatalogItems']
      and (select count(*) from jsonb_object_keys(value)) = 4
      and char_length(value ->> 'headline') between 1 and 200
      and char_length(value ->> 'privacyNotice') between 1 and 5000
    from config
  ),
  'config surfaces exactly the allowlisted merchant display copy with safe defaults'
);

select set_config(
  'renoly.test.upload_one',
  public.create_pilot_intake_upload(
    encode(extensions.digest('alpha-valid-intake', 'sha256'), 'hex'),
    '91000000-0000-4000-8000-000000000001',
    encode(extensions.digest('203.0.113.10', 'sha256'), 'hex'),
    '現場照片.jpg', 'image/jpeg', 1024, repeat('a', 64)
  )::text,
  true
);
select ok(
  current_setting('renoly.test.upload_one')::jsonb #>> '{storagePath}' like
    'org/20000000-0000-4000-8000-000000000001/service-requests/91000000-0000-4000-8000-000000000001/%/upload'
  and not (current_setting('renoly.test.upload_one') ~* 'token|ipHash'),
  'upload reservation returns a scoped object path without capability data'
);
select ok(
  (
    with verification as (
      select public.get_pilot_intake_upload_verification(
        encode(extensions.digest('alpha-valid-intake', 'sha256'), 'hex'),
        '91000000-0000-4000-8000-000000000001',
        (current_setting('renoly.test.upload_one')::jsonb ->> 'uploadId')::uuid
      ) as value
    )
    select value ?& array[
      'uploadId', 'storageBucket', 'storagePath', 'declaredMimeType',
      'declaredByteSize', 'declaredSha256', 'status', 'expiresAt'
    ]
      and (select count(*) from jsonb_object_keys(value)) = 8
      and value ->> 'storageBucket' = 'v2-intake-photos'
    from verification
  ),
  'verification DTO exposes exactly the allowlisted storage metadata'
);

select throws_ok(
  format(
    'select public.complete_pilot_intake_upload(%L, %L::uuid, %L::uuid, %L, 1024, %L, 1200, 900)',
    encode(extensions.digest('beta-valid-intake', 'sha256'), 'hex'),
    '91000000-0000-4000-8000-000000000001',
    current_setting('renoly.test.upload_one')::jsonb ->> 'uploadId',
    'image/jpeg', repeat('a', 64)
  ),
  'P0002', 'PILOT_UPLOAD_NOT_FOUND', 'another tenant capability cannot finalize an upload'
);
select is(
  public.complete_pilot_intake_upload(
    encode(extensions.digest('alpha-valid-intake', 'sha256'), 'hex'),
    '91000000-0000-4000-8000-000000000001',
    (current_setting('renoly.test.upload_one')::jsonb ->> 'uploadId')::uuid,
    'image/jpeg', 1024, repeat('a', 64), 1200, 900
  ) ->> 'status',
  'ready',
  'owning capability can finalize matching verified upload metadata'
);
select is(
  (
    select use_count from public.public_access_tokens
    where token_hash = extensions.digest('alpha-valid-intake', 'sha256')
  ),
  0,
  'config and upload verification do not consume the public capability'
);

select set_config(
  'renoly.test.upload_other',
  public.create_pilot_intake_upload(
    encode(extensions.digest('alpha-valid-intake', 'sha256'), 'hex'),
    '91000000-0000-4000-8000-000000000002',
    encode(extensions.digest('203.0.113.10', 'sha256'), 'hex'),
    '另一案件.jpg', 'image/jpeg', 2048, repeat('b', 64)
  )::text,
  true
);
select public.complete_pilot_intake_upload(
  encode(extensions.digest('alpha-valid-intake', 'sha256'), 'hex'),
  '91000000-0000-4000-8000-000000000002',
  (current_setting('renoly.test.upload_other')::jsonb ->> 'uploadId')::uuid,
  'image/jpeg', 2048, repeat('b', 64), 800, 600
);

select throws_ok(
  format(
    'select public.submit_pilot_service_request(%L, %L::uuid, %L, %L, %L::jsonb, array[%L::uuid])',
    encode(extensions.digest('alpha-valid-intake', 'sha256'), 'hex'),
    '91000000-0000-4000-8000-000000000001', 'wrong-photo-owner',
    encode(extensions.digest('203.0.113.10', 'sha256'), 'hex'),
    jsonb_build_object(
      'serviceCatalogItemId', '71100000-0000-4000-8000-000000000001',
      'contactName', '王小明', 'contactPhone', '+886912345678',
      'subject', '冷氣不冷', 'description', '運轉但沒有冷風',
      'address', jsonb_build_object('county', '台北市', 'district', '中山區', 'addressLine', '測試路 10 號'),
      'preferredWindows', '[]'::jsonb
    )::text,
    current_setting('renoly.test.upload_other')::jsonb ->> 'uploadId'
  ),
  '42501', 'PILOT_UPLOAD_INVALID', 'an upload cannot be attached to a different intake session'
);

select set_config(
  'renoly.test.request_payload',
  jsonb_build_object(
    'serviceCatalogItemId', '71100000-0000-4000-8000-000000000001',
    'contactName', '王小明', 'contactPhone', '+886912345678',
    'subject', '冷氣不冷', 'description', '運轉但沒有冷風',
    'address', jsonb_build_object(
      'postalCode', '104', 'county', '台北市', 'district', '中山區',
      'addressLine', '測試路 10 號', 'accessNotes', '請先電話聯絡'
    ),
    'preferredWindows', jsonb_build_array(
      jsonb_build_object(
        'startsAt', (statement_timestamp() + interval '1 day')::text,
        'endsAt', (statement_timestamp() + interval '1 day 2 hours')::text,
        'preferenceRank', 1
      )
    )
  )::text,
  true
);
select throws_ok(
  format(
    'select public.submit_pilot_service_request(%L, %L::uuid, %L, %L, %L::jsonb, %L::uuid[])',
    encode(extensions.digest('alpha-valid-intake', 'sha256'), 'hex'),
    '91000000-0000-4000-8000-000000000001', 'session-hijack-attempt',
    encode(extensions.digest('203.0.113.11', 'sha256'), 'hex'),
    current_setting('renoly.test.request_payload'), '{}'
  ),
  '42501', 'PILOT_UPLOAD_INVALID', 'a submission UUID bound by an upload cannot be hijacked from another IP'
);
select set_config(
  'renoly.test.submit_response',
  public.submit_pilot_service_request(
    encode(extensions.digest('alpha-valid-intake', 'sha256'), 'hex'),
    '91000000-0000-4000-8000-000000000001', 'intake-idempotency-1',
    encode(extensions.digest('203.0.113.10', 'sha256'), 'hex'),
    current_setting('renoly.test.request_payload')::jsonb,
    array[(current_setting('renoly.test.upload_one')::jsonb ->> 'uploadId')::uuid]
  )::text,
  true
);
select ok(
  current_setting('renoly.test.submit_response')::jsonb ->> 'serviceRequestId'
    = '91000000-0000-4000-8000-000000000001'
  and current_setting('renoly.test.submit_response')::jsonb ->> 'status' = 'new'
  and not (current_setting('renoly.test.submit_response') ~* 'phone|address|metadata|token|hash'),
  'submission returns only a customer-safe confirmation DTO'
);

reset role;
select ok(
  exists (
    select 1 from public.photos
    where id = (current_setting('renoly.test.upload_one')::jsonb ->> 'uploadId')::uuid
      and service_request_id = '91000000-0000-4000-8000-000000000001'
      and category = 'intake' and status = 'ready'
  )
  and exists (
    select 1 from private.pilot_intake_uploads
    where id = (current_setting('renoly.test.upload_one')::jsonb ->> 'uploadId')::uuid
      and consumed_at is not null
      and service_request_id = '91000000-0000-4000-8000-000000000001'
  ),
  'ready temporary upload is attached once and marked consumed atomically'
);
select ok(
  exists (
    select 1 from public.events
    where organization_id = '20000000-0000-4000-8000-000000000001'
      and aggregate_type = 'service_request'
      and aggregate_id = '91000000-0000-4000-8000-000000000001'
      and event_type = 'service_request.public_submitted'
      and actor_type = 'system' and chain_sequence = 1 and event_hash is not null
  ),
  'public submission appends a chained system audit event'
);

set local role service_role;
select is(
  public.submit_pilot_service_request(
    encode(extensions.digest('alpha-valid-intake', 'sha256'), 'hex'),
    '91000000-0000-4000-8000-000000000001', 'intake-idempotency-1',
    encode(extensions.digest('203.0.113.10', 'sha256'), 'hex'),
    current_setting('renoly.test.request_payload')::jsonb,
    array[(current_setting('renoly.test.upload_one')::jsonb ->> 'uploadId')::uuid]
  ),
  current_setting('renoly.test.submit_response')::jsonb,
  'same idempotency key and canonical body replays the original response'
);
select is(
  (
    select use_count from public.public_access_tokens
    where token_hash = extensions.digest('alpha-valid-intake', 'sha256')
  ),
  1,
  'only the newly accepted submission consumes the capability; replay does not'
);
select throws_ok(
  format(
    'select public.submit_pilot_service_request(%L, %L::uuid, %L, %L, %L::jsonb, array[%L::uuid])',
    encode(extensions.digest('alpha-valid-intake', 'sha256'), 'hex'),
    '91000000-0000-4000-8000-000000000001', 'intake-idempotency-1',
    encode(extensions.digest('203.0.113.10', 'sha256'), 'hex'),
    (current_setting('renoly.test.request_payload')::jsonb || '{"subject":"不同內容"}'::jsonb)::text,
    current_setting('renoly.test.upload_one')::jsonb ->> 'uploadId'
  ),
  '22023', 'PILOT_IDEMPOTENCY_CONFLICT', 'same idempotency key with a different body is rejected'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select ok(
  (
    with inbox as (
      select public.list_pilot_service_requests(
        '20000000-0000-4000-8000-000000000001', 25
      ) as value
    )
    select jsonb_path_exists(value, '$.items[*] ? (@.id == "91000000-0000-4000-8000-000000000001")')
      and value::text like '%分離式冷氣清洗%'
      and value::text like '%台北市中山區測試路 10 號%'
      and not (value::text ~* 'metadata|defaultCost|token|hash')
    from inbox
  ),
  'authorized staff inbox includes service, display address and photo count without internal columns'
);

reset role;
select set_config(
  'renoly.test.gamma_service_item',
  (
    select id::text from public.service_catalog_items
    where organization_id = current_setting('renoly.test.gamma_org')::uuid
    order by sort_order, id limit 1
  ),
  true
);
-- Five new requests from a fresh token/IP bucket are allowed; the sixth is
-- rejected atomically. Each loop uses a unique intake UUID and idempotency key.
select lives_ok(
  $$do $rate_test$
  declare
    i integer;
    intake_id uuid;
    body jsonb := jsonb_build_object(
      'serviceCatalogItemId', '71100000-0000-4000-8000-000000000001',
      'contactName', '速率測試', 'contactPhone', '+886912345678',
      'subject', '速率測試案件', 'description', '',
      'address', jsonb_build_object('addressLine', '速率測試路 1 號'),
      'preferredWindows', '[]'::jsonb
    );
  begin
    for i in 1..5 loop
      intake_id := ('92000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid;
      perform public.submit_pilot_service_request(
        encode(extensions.digest('alpha-valid-intake', 'sha256'), 'hex'),
        intake_id, 'rate-test-' || i,
        encode(extensions.digest('198.51.100.22', 'sha256'), 'hex'),
        body, '{}'::uuid[]
      );
    end loop;
  end
  $rate_test$;$$,
  'five requests in one 15-minute token/IP bucket are accepted'
);
select throws_ok(
  format(
    'select public.submit_pilot_service_request(%L, %L::uuid, %L, %L, %L::jsonb, %L::uuid[])',
    encode(extensions.digest('alpha-valid-intake', 'sha256'), 'hex'),
    '92000000-0000-4000-8000-000000000006', 'rate-test-6',
    encode(extensions.digest('198.51.100.22', 'sha256'), 'hex'),
    jsonb_build_object(
      'serviceCatalogItemId', '71100000-0000-4000-8000-000000000001',
      'contactName', '速率測試', 'contactPhone', '+886912345678',
      'subject', '速率測試案件', 'description', '',
      'address', jsonb_build_object('addressLine', '速率測試路 1 號'),
      'preferredWindows', '[]'::jsonb
    )::text,
    '{}'
  ),
  'P0001', 'PILOT_RATE_LIMITED', 'sixth request in the rate bucket is rejected'
);
select is(
  (
    select request_count from private.pilot_intake_rate_limits
    where token_id = (
      select id from public.public_access_tokens
      where token_hash = extensions.digest('alpha-valid-intake', 'sha256')
    )
      and ip_hash = extensions.digest('198.51.100.22', 'sha256')
      and action = 'submit'
  ),
  5,
  'database-backed rate counter does not persist the rejected increment'
);

set local role service_role;
select throws_ok(
  format(
    'select public.submit_pilot_service_request(%L, %L::uuid, %L, %L, %L::jsonb, %L::uuid[])',
    encode(extensions.digest('alpha-valid-intake', 'sha256'), 'hex'),
    '93000000-0000-4000-8000-000000000001', 'cross-tenant-service',
    encode(extensions.digest('203.0.113.99', 'sha256'), 'hex'),
    jsonb_build_object(
      'serviceCatalogItemId', current_setting('renoly.test.gamma_service_item'),
      'contactName', '跨租戶測試', 'contactPhone', '+886912345678',
      'subject', '跨租戶', 'description', '',
      'address', jsonb_build_object('addressLine', '測試路 99 號'),
      'preferredWindows', '[]'::jsonb
    )::text,
    '{}'
  ),
  '42501', 'PILOT_SERVICE_NOT_AVAILABLE', 'a tenant capability cannot select another tenant service'
);

-- ---------------------------------------------------------------------------
-- D4: staff idempotency for create_pilot_organization and rotate_pilot_intake_token.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);

-- Replaying the original create with the same key and canonical body returns the
-- stored response and does NOT create a second organization.
select is(
  public.create_pilot_organization(
    'Gamma 水電工程', 'gamma-pilot', 'plumbing', 'Asia/Taipei', 'TWD',
    'Gamma 老闆', encode(extensions.digest('gamma-intake-token-replay', 'sha256'), 'hex'),
    'gamma-org-idempotency-1'
  )::text,
  current_setting('renoly.test.pilot_create_response'),
  'create_pilot_organization replays the first response for the same idempotency key'
);

reset role;
select is(
  (
    select count(*)::integer from public.organizations
    where slug = 'gamma-pilot'
  ),
  1,
  'replaying the create idempotency key does not create a duplicate organization'
);
select is(
  (
    select count(*)::integer from public.public_access_tokens
    where organization_id = current_setting('renoly.test.gamma_org')::uuid
      and token_hash = extensions.digest('gamma-intake-token-replay', 'sha256')
      and revoked_at is null
  ),
  1,
  'a replayed create persists the retry token hash so the returned intake link resolves'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select throws_ok(
  $$select public.create_pilot_organization(
      'Gamma 改名', 'gamma-pilot-2', 'cooling', 'Asia/Taipei', 'TWD',
      'Gamma 老闆', repeat('a', 64), 'gamma-org-idempotency-1'
    )$$,
  '22023', 'PILOT_IDEMPOTENCY_CONFLICT',
  'reusing the create idempotency key with a different body is rejected'
);

-- The intake tokens minted for the new organization carry a finite submission
-- cap instead of the previous unlimited (NULL) max_uses.
reset role;
select is(
  (
    select max_uses from public.public_access_tokens
    where organization_id = current_setting('renoly.test.gamma_org')::uuid
      and token_hash = extensions.digest('gamma-rotated-token', 'sha256')
  ),
  500,
  'rotated intake tokens are minted with a finite submission cap'
);

-- Replaying the rotate with the same key and same new-token hash returns the
-- stored response and does NOT revoke the just-issued link a second time.
select is(
  (
    select count(*)::integer from public.public_access_tokens
    where organization_id = current_setting('renoly.test.gamma_org')::uuid
      and token_hash = extensions.digest('gamma-rotated-token', 'sha256')
      and revoked_at is null
  ),
  1,
  'the rotated intake link is active before a retry'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select lives_ok(
  format(
    'select public.rotate_pilot_intake_token(%L::uuid, %L, %L)',
    current_setting('renoly.test.gamma_org'),
    encode(extensions.digest('gamma-rotated-token', 'sha256'), 'hex'),
    'gamma-rotate-idempotency-1'
  ),
  'replaying the rotate idempotency key with the same token hash succeeds'
);

reset role;
select is(
  (
    select count(*)::integer from public.public_access_tokens
    where organization_id = current_setting('renoly.test.gamma_org')::uuid
      and token_hash = extensions.digest('gamma-rotated-token', 'sha256')
      and revoked_at is null
  ),
  1,
  'a rotate retry does not revoke the freshly issued intake link'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select throws_ok(
  format(
    'select public.rotate_pilot_intake_token(%L::uuid, %L, %L)',
    current_setting('renoly.test.gamma_org'),
    repeat('f', 64),
    'gamma-rotate-idempotency-1'
  ),
  '22023', 'PILOT_IDEMPOTENCY_CONFLICT',
  'a rotate retry that mints a different token hash is rejected as a conflict'
);

-- ---------------------------------------------------------------------------
-- D5: create_pilot_intake_upload per token+IP hourly mint rate limit.
-- ---------------------------------------------------------------------------
reset role;
set local role service_role;
-- Ten reservations from one token/IP in the hourly bucket are accepted.
select lives_ok(
  $$do $upload_rate$
  declare
    i integer;
  begin
    for i in 1..10 loop
      perform public.create_pilot_intake_upload(
        encode(extensions.digest('beta-valid-intake', 'sha256'), 'hex'),
        ('94000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
        encode(extensions.digest('198.51.100.50', 'sha256'), 'hex'),
        '照片.jpg', 'image/jpeg', 1024, repeat('a', 64)
      );
    end loop;
  end
  $upload_rate$;$$,
  'ten upload reservations in one hourly token/IP bucket are accepted'
);
select throws_ok(
  format(
    'select public.create_pilot_intake_upload(%L, %L::uuid, %L, %L, %L, 1024, %L)',
    encode(extensions.digest('beta-valid-intake', 'sha256'), 'hex'),
    '94000000-0000-4000-8000-000000000011',
    encode(extensions.digest('198.51.100.50', 'sha256'), 'hex'),
    '照片.jpg', 'image/jpeg', repeat('a', 64)
  ),
  'P0001', 'PILOT_RATE_LIMITED',
  'the eleventh upload reservation in the hourly bucket is rejected'
);

select * from finish();
rollback;
