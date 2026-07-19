begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(21);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);

select throws_ok(
  $$select public.transition_work_order_safe(
      '20000000-0000-4000-8000-000000000001',
      '82000000-0000-4000-8000-000000000001',
      'dispatched', 1, null, null, null, null, null, 'rpc-test-null-occurred-at'
    )$$,
  '22023', 'OCCURRED_AT_REQUIRED', 'transition requires the client occurrence time'
);

select throws_ok(
  $$select public.transition_work_order_safe(
      '20000000-0000-4000-8000-000000000001',
      '82000000-0000-4000-8000-000000000001',
      'dispatched', null, statement_timestamp(), null, null, null, null, 'rpc-test-null-lock'
    )$$,
  '40001', 'STALE_VERSION', 'null expected lock version fails closed'
);

select throws_ok(
  $$select public.transition_work_order_safe(
      '20000000-0000-4000-8000-000000000001',
      '82000000-0000-4000-8000-000000000001',
      'dispatched', 1, statement_timestamp() - interval '25 hours',
      null, null, null, null, 'rpc-test-uncorrected-old-time'
    )$$,
  '22023', 'OCCURRED_AT_OUT_OF_RANGE', 'out-of-range occurrence requires a manager correction reason'
);

select throws_ok(
  $$select public.transition_work_order_safe(
      '20000000-0000-4000-8000-000000000001',
      '82000000-0000-4000-8000-000000000001',
      'dispatched', 1, statement_timestamp() + interval '1 day',
      null, null, '主管要求寫入未來', null, 'rpc-test-future-correction'
    )$$,
  '22023', 'OCCURRED_AT_OUT_OF_RANGE', 'even a manager correction cannot create far-future state timestamps'
);

select is(
  public.transition_work_order_safe(
    '20000000-0000-4000-8000-000000000001',
    '82000000-0000-4000-8000-000000000001',
    'dispatched', 1, statement_timestamp() - interval '25 hours',
    null, null, '主管核准離線補登', null, 'rpc-test-dispatch'
  ) ->> 'status',
  'dispatched',
  'owner dispatches with an explicit out-of-range correction'
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);
select is(
  public.transition_work_order_safe(
    '20000000-0000-4000-8000-000000000001',
    '82000000-0000-4000-8000-000000000001',
    'en_route', 2, statement_timestamp(), null, null, null, null, 'rpc-test-en-route'
  ) ->> 'status',
  'en_route',
  'assigned technician starts travel through safe RPC'
);

select ok(
  (
    select dto ? 'workOrderNo'
      and not (dto ? 'work_order_no')
      and not (dto ? 'internal_notes')
    from (
      select public.transition_work_order_safe(
        '20000000-0000-4000-8000-000000000001',
        '82000000-0000-4000-8000-000000000001',
        'on_site', 3, statement_timestamp(), null, null, null, null, 'rpc-test-on-site'
      ) as dto
    ) transition_result
  ),
  'transition DTO is a camelCase allowlist for every role'
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000004', true);
select throws_ok(
  $$select public.transition_work_order_safe(
      '20000000-0000-4000-8000-000000000001',
      '82000000-0000-4000-8000-000000000001',
      'paused', 4, statement_timestamp(), null, null, null, null, 'rpc-test-unassigned'
    )$$,
  '42501', 'FORBIDDEN', 'unassigned technician cannot transition the work order'
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);
select throws_ok(
  $$select public.transition_work_order_safe(
      '20000000-0000-4000-8000-000000000001',
      '82000000-0000-4000-8000-000000000001',
      'completed', 4, statement_timestamp(), null, '清洗完成', null, null,
      'rpc-test-incomplete-checklist'
    )$$,
  '23514', 'REQUIRED_CHECKLIST_INCOMPLETE', 'required checklist blocks completion'
);

select is(
  public.respond_to_checklist_item(
    '20000000-0000-4000-8000-000000000001',
    '84100000-0000-4000-8000-000000000001', 'true'::jsonb, 4
  ) -> 'response',
  'true'::jsonb,
  'assigned technician records a typed checklist response'
);

select throws_ok(
  $$select public.transition_work_order_safe(
      '20000000-0000-4000-8000-000000000001',
      '82000000-0000-4000-8000-000000000001',
      'completed', 4, statement_timestamp(), null, '清洗完成', null, null,
      'rpc-test-missing-evidence'
    )$$,
  '23514', 'REQUIRED_EVIDENCE_MISSING', 'required checklist evidence blocks completion'
);

select set_config(
  'renoly.test.before_photo_id',
  public.create_photo_upload(
    '20000000-0000-4000-8000-000000000001', 'work_order',
    '82000000-0000-4000-8000-000000000001', 'before', 'before.jpg',
    'image/jpeg', 1024, repeat('a', 64), '84100000-0000-4000-8000-000000000001'
  ) ->> 'photoId',
  true
);

reset role;
update public.photos
set status = 'ready', ready_at = statement_timestamp(), width = 1200, height = 900,
    sha256 = repeat('a', 64)
where id = current_setting('renoly.test.before_photo_id')::uuid;

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);
select throws_ok(
  $$select public.transition_work_order_safe(
      '20000000-0000-4000-8000-000000000001',
      '82000000-0000-4000-8000-000000000001',
      'completed', 4, statement_timestamp(), null, '清洗完成', null, null,
      'rpc-test-missing-after-photo'
    )$$,
  '23514', 'BEFORE_AFTER_PHOTOS_REQUIRED', 'both before and after photos are required'
);

select set_config(
  'renoly.test.after_photo_id',
  public.create_photo_upload(
    '20000000-0000-4000-8000-000000000001', 'work_order',
    '82000000-0000-4000-8000-000000000001', 'after', 'after.jpg',
    'image/jpeg', 2048, repeat('b', 64), null
  ) ->> 'photoId',
  true
);

reset role;
update public.photos
set status = 'ready', ready_at = statement_timestamp(), width = 1200, height = 900,
    sha256 = repeat('b', 64)
where id = current_setting('renoly.test.after_photo_id')::uuid;

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);
select is(
  public.transition_work_order_safe(
    '20000000-0000-4000-8000-000000000001',
    '82000000-0000-4000-8000-000000000001',
    'completed', 4, statement_timestamp(), null, '清洗完成', null, null,
    'rpc-test-complete'
  ) ->> 'status',
  'completed',
  'complete succeeds after checklist and verified before/after evidence'
);

reset role;
select is(
  (select completion_summary from public.work_orders
   where id = '82000000-0000-4000-8000-000000000001'),
  '清洗完成',
  'completion summary is persisted'
);
select is(
  (select max(chain_sequence) from public.events
   where organization_id = '20000000-0000-4000-8000-000000000001'
     and aggregate_type = 'work_order'
     and aggregate_id = '82000000-0000-4000-8000-000000000001'),
  5::bigint,
  'work-order audit chain advances monotonically across backdated and current events'
);
select ok(
  (
    with ordered as (
      select chain_sequence, prev_hash,
             lag(event_hash) over (order by chain_sequence) as expected_prev_hash
      from public.events
      where organization_id = '20000000-0000-4000-8000-000000000001'
        and aggregate_type = 'work_order'
        and aggregate_id = '82000000-0000-4000-8000-000000000001'
    )
    select bool_and(prev_hash is not distinct from expected_prev_hash) from ordered
  ),
  'every work-order event links to the immediately preceding sequence hash'
);
select ok(
  not exists (
    select 1
    from public.events e
    where e.organization_id = '20000000-0000-4000-8000-000000000001'
      and e.aggregate_type = 'work_order'
      and e.aggregate_id = '82000000-0000-4000-8000-000000000001'
      and e.event_hash is distinct from extensions.digest(
        coalesce(encode(e.prev_hash, 'hex'), '') || '|' || e.organization_id::text || '|'
        || e.aggregate_type || '|' || e.aggregate_id::text || '|'
        || e.event_type || '|' || e.actor_user_id::text || '|' || e.occurred_at::text || '|'
        || e.recorded_at::text || '|' || e.chain_sequence::text || '|' || e.payload::text,
        'sha256'
      )
  ),
  'stored work-order event hashes recompute from their canonical fields'
);
select throws_ok(
  $$update public.photos set caption = 'tampered after completion'
    where id = current_setting('renoly.test.after_photo_id')::uuid$$,
  'P0001', 'WORK_ORDER_SNAPSHOT_FROZEN', 'completion freezes work-order evidence'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
select is(
  (public.submit_quote_version_for_approval(
    '20000000-0000-4000-8000-000000000001',
    '85100000-0000-4000-8000-000000000001', 1, null, 'rpc-test-submit'
  )).approval_status,
  'pending',
  'dispatcher submits quote for approval after server total calculation'
);

reset role;
update public.memberships
set role = 'admin'
where id = '30000000-0000-4000-8000-000000000002';

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
select is(
  (public.review_quote_version(
    '20000000-0000-4000-8000-000000000001',
    '85100000-0000-4000-8000-000000000001', 2, true, null, null, 'rpc-test-approve'
  )).approval_status,
  'approved',
  'admin approves submitted quote'
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select is(
  (public.send_quote_version(
    '20000000-0000-4000-8000-000000000001',
    '85100000-0000-4000-8000-000000000001', 3, null, 'rpc-test-send'
  )).status,
  'sent',
  'only approved version can be sent'
);

reset role;
select * from finish();
rollback;
