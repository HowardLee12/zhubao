begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(76);

------------------------------------------------------------------------------
-- Fixtures. Fresh, fully-bound work orders so the shared seed WO stays intact.
-- Org Alpha (20..0001): owner 10..0001, dispatcher 10..0002,
--   technician A membership 30..0003 (user 10..0003),
--   technician B membership 30..0004 (user 10..0004).
-- Org Beta (20..0002): owner 10..0005.
--
-- Direct table reads require superuser (authenticated has no table grants; every
-- read goes through a security-definer RPC). Inspection queries therefore run
-- under `reset role`, and ids/lock versions are threaded through set_config.
------------------------------------------------------------------------------

insert into public.work_orders (
  id, organization_id, work_order_no, customer_id, location_id, title, status,
  internal_notes, created_by, updated_by
) values
  (
    '82050000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001',
    'W-M5-0001', '40000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001', 'M5 排程測試工單', 'draft',
    '只有店內可見', '10000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000002'
  ),
  (
    '82050000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001',
    'W-M5-0002', '40000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001', 'M5 完工旅程工單', 'draft',
    '', '10000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000002'
  );

------------------------------------------------------------------------------
-- RPC boundary / grants
------------------------------------------------------------------------------

select ok(has_function_privilege('authenticated', 'public.create_work_order(uuid,jsonb,text,uuid)', 'EXECUTE'), 'authenticated may create work orders');
select ok(has_function_privilege('authenticated', 'public.schedule_work_order(uuid,uuid,timestamptz,timestamptz,jsonb,integer,timestamptz,text,text,uuid)', 'EXECUTE'), 'authenticated may schedule');
select ok(has_function_privilege('authenticated', 'public.force_complete_work_order(uuid,uuid,text,text,integer,timestamptz,text,uuid)', 'EXECUTE'), 'authenticated may reach force-complete (owner gate is internal)');
select ok(has_function_privilege('authenticated', 'public.complete_work_order_photo(uuid,uuid,text,bigint,text,integer,integer,uuid)', 'EXECUTE'), 'authenticated may verify photos');
select ok(not has_function_privilege('anon', 'public.create_work_order(uuid,jsonb,text,uuid)', 'EXECUTE'), 'anon cannot create work orders');
select ok(not has_function_privilege('service_role', 'public.force_complete_work_order(uuid,uuid,text,text,integer,timestamptz,text,uuid)', 'EXECUTE'), 'service role cannot bypass the force-complete authorization');
select ok(not has_function_privilege('anon', 'public.list_work_orders(uuid,jsonb,timestamptz,uuid,integer)', 'EXECUTE'), 'anon cannot list work orders');

-- FORCE RLS confirmation on the M5 aggregates (added by the shared loop).
select ok((select relforcerowsecurity from pg_class where oid = 'public.work_orders'::regclass), 'work_orders enforces RLS for the owner role');
select ok((select relforcerowsecurity from pg_class where oid = 'public.assignments'::regclass), 'assignments enforces RLS for the owner role');
select ok((select relforcerowsecurity from pg_class where oid = 'public.photos'::regclass), 'photos enforces RLS for the owner role');

------------------------------------------------------------------------------
-- create_work_order: dispatcher happy path, tenancy, idempotency, validation
------------------------------------------------------------------------------

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);

select is(
  public.create_work_order(
    '20000000-0000-4000-8000-000000000001',
    '{"customerId":"40000000-0000-4000-8000-000000000001","locationId":"50000000-0000-4000-8000-000000000001","title":"手動建立工單","priority":"high"}'::jsonb,
    'm5-create-0001', null
  ) ->> 'status', 'draft', 'dispatcher creates a draft work order'
);
select is(
  public.create_work_order(
    '20000000-0000-4000-8000-000000000001',
    '{"customerId":"40000000-0000-4000-8000-000000000001","locationId":"50000000-0000-4000-8000-000000000001","title":"replay probe"}'::jsonb,
    'm5-create-0002', null
  ) ->> 'status', 'draft', 'a fresh key creates a distinct work order'
);
select is(
  (public.create_work_order(
    '20000000-0000-4000-8000-000000000001',
    '{"customerId":"40000000-0000-4000-8000-000000000001","locationId":"50000000-0000-4000-8000-000000000001","title":"replay probe"}'::jsonb,
    'm5-create-0002', null
  ) ->> 'replayed'), 'true', 'same idempotency key replays a single work order'
);
select throws_ok(
  $$select public.create_work_order('20000000-0000-4000-8000-000000000001', '{"customerId":"40000000-0000-4000-8000-000000000001","locationId":"50000000-0000-4000-8000-000000000001","title":"conflict"}'::jsonb, 'm5-create-0002', null)$$,
  '22023', 'IDEMPOTENCY_CONFLICT', 'reusing a key with a different payload is rejected'
);
select throws_ok(
  $$select public.create_work_order('20000000-0000-4000-8000-000000000001', '{"customerId":"40000000-0000-4000-8000-000000000001","locationId":"50000000-0000-4000-8000-000000000001"}'::jsonb, 'm5-create-0003', null)$$,
  '22023', 'WORK_ORDER_PAYLOAD_INVALID', 'missing title is rejected'
);

-- technician cannot create
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);
select throws_ok(
  $$select public.create_work_order('20000000-0000-4000-8000-000000000001', '{"customerId":"40000000-0000-4000-8000-000000000001","locationId":"50000000-0000-4000-8000-000000000001","title":"nope"}'::jsonb, 'm5-tech-0001', null)$$,
  '42501', 'FORBIDDEN', 'technician cannot create a work order'
);
-- cross tenant: Beta owner cannot create in Alpha
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000005', true);
select throws_ok(
  $$select public.create_work_order('20000000-0000-4000-8000-000000000001', '{"customerId":"40000000-0000-4000-8000-000000000001","locationId":"50000000-0000-4000-8000-000000000001","title":"cross"}'::jsonb, 'm5-cross-0001', null)$$,
  '42501', 'FORBIDDEN', 'another tenant manager cannot create in Alpha'
);

------------------------------------------------------------------------------
-- schedule_work_order: atomic schedule + assign + transition draft->scheduled
------------------------------------------------------------------------------

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);

select is(
  public.schedule_work_order(
    '20000000-0000-4000-8000-000000000001', '82050000-0000-4000-8000-000000000001',
    '2026-09-01 01:00:00+00', '2026-09-01 03:00:00+00',
    '[{"membershipId":"30000000-0000-4000-8000-000000000003","duty":"lead"}]'::jsonb,
    1, statement_timestamp(), null, null, null
  ) ->> 'status', 'scheduled', 'schedule atomically moves draft to scheduled'
);

reset role;
select is(
  (select status from public.assignments where work_order_id = '82050000-0000-4000-8000-000000000001' and membership_id = '30000000-0000-4000-8000-000000000003'),
  'assigned', 'schedule creates the technician assignment in the same transaction'
);
select is(
  (select event_type from public.events where aggregate_id = '82050000-0000-4000-8000-000000000001' order by chain_sequence desc limit 1),
  'work_order.scheduled_dispatch', 'schedule appends the dispatch bookkeeping event'
);
select ok(
  exists (select 1 from public.events where aggregate_id = '82050000-0000-4000-8000-000000000001' and event_type = 'work_order.scheduled'),
  'schedule also runs the authoritative status transition event'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
-- stale lock
select throws_ok(
  $$select public.schedule_work_order('20000000-0000-4000-8000-000000000001', '82050000-0000-4000-8000-000000000001', '2026-09-01 01:00:00+00', '2026-09-01 03:00:00+00', '[{"membershipId":"30000000-0000-4000-8000-000000000003","duty":"lead"}]'::jsonb, 1, statement_timestamp(), null, null, null)$$,
  '40001', 'STALE_VERSION', 'a stale schedule lock version is rejected'
);
-- already scheduled -> not schedulable
select throws_ok(
  $$select public.schedule_work_order('20000000-0000-4000-8000-000000000001', '82050000-0000-4000-8000-000000000001', '2026-09-01 01:00:00+00', '2026-09-01 03:00:00+00', '[{"membershipId":"30000000-0000-4000-8000-000000000003","duty":"lead"}]'::jsonb, 3, statement_timestamp(), null, null, null)$$,
  '23514', 'WORK_ORDER_NOT_SCHEDULABLE', 'a non-draft work order cannot be re-scheduled through this path'
);
-- invalid window
select throws_ok(
  $$select public.schedule_work_order('20000000-0000-4000-8000-000000000001', '82050000-0000-4000-8000-000000000002', '2026-09-01 03:00:00+00', '2026-09-01 01:00:00+00', '[{"membershipId":"30000000-0000-4000-8000-000000000003","duty":"lead"}]'::jsonb, 1, statement_timestamp(), null, null, null)$$,
  '22023', 'SCHEDULE_PAYLOAD_INVALID', 'an inverted schedule window is rejected'
);

------------------------------------------------------------------------------
-- Schedule conflict: overlap blocks dispatcher, owner override with reason passes
------------------------------------------------------------------------------

-- 82050000..0002 overlaps 82050000..0001 (same tech A, same day).
select throws_ok(
  $$select public.schedule_work_order('20000000-0000-4000-8000-000000000001', '82050000-0000-4000-8000-000000000002', '2026-09-01 02:00:00+00', '2026-09-01 04:00:00+00', '[{"membershipId":"30000000-0000-4000-8000-000000000003","duty":"lead"}]'::jsonb, 1, statement_timestamp(), null, null, null)$$,
  'RENSC', 'SCHEDULE_CONFLICT', 'a plain dispatcher cannot double-book a technician'
);
-- owner overrides
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select is(
  public.schedule_work_order(
    '20000000-0000-4000-8000-000000000001', '82050000-0000-4000-8000-000000000002',
    '2026-09-01 02:00:00+00', '2026-09-01 04:00:00+00',
    '[{"membershipId":"30000000-0000-4000-8000-000000000003","duty":"lead"}]'::jsonb,
    1, statement_timestamp(), '衝突已與客戶確認', null, null
  ) ->> 'status', 'scheduled', 'owner may override a schedule conflict with a reason'
);

-- check_schedule_conflicts read RPC surfaces the overlap
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
select ok(
  jsonb_array_length(
    public.check_schedule_conflicts(
      '20000000-0000-4000-8000-000000000001',
      array['30000000-0000-4000-8000-000000000003']::uuid[],
      '2026-09-01 01:30:00+00', '2026-09-01 02:30:00+00', null
    ) -> 'conflicts'
  ) >= 1, 'check_schedule_conflicts reports the overlapping window'
);

------------------------------------------------------------------------------
-- Assignment lifecycle: create, one-active-lead, technician self-respond, cancel
------------------------------------------------------------------------------

-- add a second (helper) assignment to WO ..0001
select is(
  public.create_assignment(
    '20000000-0000-4000-8000-000000000001', '82050000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000004', 'helper', 'm5-assign-0001', null
  ) ->> 'status', 'assigned', 'dispatcher assigns a helper technician'
);
-- second active lead blocked by the one-active-lead partial index.
-- Use a FRESH eligible membership (dispatcher 30..0002, never assigned to this WO)
-- so the insert clears assignments_work_order_member_uidx and can only trip
-- assignments_one_active_lead_uidx — 30..0003 is still the active lead here.
select throws_like(
  $$select public.create_assignment('20000000-0000-4000-8000-000000000001', '82050000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002', 'lead', 'm5-assign-lead', null)$$,
  '%assignments_one_active_lead%', 'a second active lead is rejected by the one-active-lead index'
);

reset role;
select set_config('test.m5_a3', (select id::text from public.assignments where work_order_id = '82050000-0000-4000-8000-000000000001' and membership_id = '30000000-0000-4000-8000-000000000003'), true);
select set_config('test.m5_a3_lv', (select lock_version::text from public.assignments where work_order_id = '82050000-0000-4000-8000-000000000001' and membership_id = '30000000-0000-4000-8000-000000000003'), true);
select set_config('test.m5_a4', (select id::text from public.assignments where work_order_id = '82050000-0000-4000-8000-000000000001' and membership_id = '30000000-0000-4000-8000-000000000004'), true);
select set_config('test.m5_a4_lv', (select lock_version::text from public.assignments where work_order_id = '82050000-0000-4000-8000-000000000001' and membership_id = '30000000-0000-4000-8000-000000000004'), true);

-- technician A accepts their own assignment
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);
select is(
  public.respond_to_assignment(
    '20000000-0000-4000-8000-000000000001', current_setting('test.m5_a3')::uuid,
    'accept', null, current_setting('test.m5_a3_lv')::integer, 'm5-respond-0001', null
  ) ->> 'status', 'accepted', 'a technician accepts their own assignment'
);
-- a technician cannot respond to someone else's assignment
select throws_ok(
  $$select public.respond_to_assignment('20000000-0000-4000-8000-000000000001', current_setting('test.m5_a4')::uuid, 'accept', null, current_setting('test.m5_a4_lv')::integer, null, null)$$,
  '42501', 'FORBIDDEN', 'a technician cannot accept a peer assignment'
);
-- decline requires a reason (A already accepted, so decline the seed WO assignment instead is not needed; test the reason gate on a fresh decline attempt on an accepted lead is invalid; use payload gate)
select throws_ok(
  $$select public.respond_to_assignment('20000000-0000-4000-8000-000000000001', current_setting('test.m5_a3')::uuid, 'sideways', null, 4, null, null)$$,
  '22023', 'ASSIGNMENT_RESPONSE_INVALID', 'an unknown response decision is rejected'
);
-- manager cancels the helper assignment (reason required)
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
select throws_ok(
  $$select public.cancel_assignment('20000000-0000-4000-8000-000000000001', current_setting('test.m5_a4')::uuid, '   ', current_setting('test.m5_a4_lv')::integer, null)$$,
  '23514', 'ASSIGNMENT_CANCEL_REASON_REQUIRED', 'cancelling an assignment without a reason is rejected'
);
select is(
  public.cancel_assignment(
    '20000000-0000-4000-8000-000000000001', current_setting('test.m5_a4')::uuid,
    '客戶取消協助', current_setting('test.m5_a4_lv')::integer, null
  ) ->> 'status', 'cancelled', 'manager soft-cancels an assignment with a reason'
);

------------------------------------------------------------------------------
-- Technician visibility: only-own lists, detail column trimming, tenancy 404
------------------------------------------------------------------------------

-- technician B has no active assignments on ..0001 (helper was cancelled)
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000004', true);
select is(
  jsonb_array_length(public.list_work_orders('20000000-0000-4000-8000-000000000001') -> 'items'),
  0, 'a technician with no active assignments sees an empty list'
);
select throws_ok(
  $$select public.get_work_order_detail('20000000-0000-4000-8000-000000000001', '82050000-0000-4000-8000-000000000001')$$,
  'P0002', 'WORK_ORDER_NOT_FOUND', 'an unassigned technician gets a uniform 404, not a permission leak'
);

-- technician A sees the work order and receives NO internal notes
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);
select ok(
  jsonb_array_length(public.list_work_orders('20000000-0000-4000-8000-000000000001') -> 'items') >= 1,
  'an assigned technician sees their own work order'
);
select is(
  public.get_work_order_detail('20000000-0000-4000-8000-000000000001', '82050000-0000-4000-8000-000000000001') -> 'internalNotes',
  'null'::jsonb, 'technician detail omits internal notes'
);
-- manager keeps internal notes
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
select is(
  public.get_work_order_detail('20000000-0000-4000-8000-000000000001', '82050000-0000-4000-8000-000000000001') ->> 'internalNotes',
  '只有店內可見', 'manager detail keeps internal notes'
);
-- cross-tenant read is a 404
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000005', true);
select throws_ok(
  $$select public.get_work_order_detail('20000000-0000-4000-8000-000000000001', '82050000-0000-4000-8000-000000000001')$$,
  'P0002', 'WORK_ORDER_NOT_FOUND', 'a cross-tenant read returns 404 with no existence leak'
);

------------------------------------------------------------------------------
-- Full field journey on ..0002: dispatch, field states, checklist, photos,
-- completion gate (positive), plus the blocked-completion negatives.
------------------------------------------------------------------------------

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);

-- inline checklist (required + evidence)
select set_config('test.m5_cl', (
  select public.create_work_order_checklist(
    '20000000-0000-4000-8000-000000000001', '82050000-0000-4000-8000-000000000002',
    '完工檢查', '[{"label":"確認運轉正常","responseType":"boolean","isRequired":true,"evidenceRequired":true}]'::jsonb, null
  ) ->> 'checklistId'), true);
reset role;
select set_config('test.m5_item', (
  select id::text from public.work_order_checklist_items
  where work_order_checklist_id = current_setting('test.m5_cl')::uuid), true);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
-- dispatch (scheduled lock=3 after owner override -> dispatched)
select is(
  public.transition_work_order_safe('20000000-0000-4000-8000-000000000001', '82050000-0000-4000-8000-000000000002', 'dispatched', 3, statement_timestamp()) ->> 'status',
  'dispatched', 'manager dispatches the scheduled work order'
);
-- technician drives the field states
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);
select is(public.transition_work_order_safe('20000000-0000-4000-8000-000000000001', '82050000-0000-4000-8000-000000000002', 'en_route', 4, statement_timestamp()) ->> 'status', 'en_route', 'technician marks en route');
select is(public.transition_work_order_safe('20000000-0000-4000-8000-000000000001', '82050000-0000-4000-8000-000000000002', 'on_site', 5, statement_timestamp()) ->> 'status', 'on_site', 'technician marks on site');

-- illegal transition: scheduled seed WO cannot jump to completed
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
select throws_ok(
  $$select public.transition_work_order_safe('20000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000001', 'completed', 1, statement_timestamp(), null, 'x')$$,
  '23514', 'INVALID_WORK_ORDER_TRANSITION', 'a scheduled work order cannot jump straight to completed'
);

-- respond checklist item + event wiring
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);
select is(
  public.respond_to_checklist_item('20000000-0000-4000-8000-000000000001', current_setting('test.m5_item')::uuid, 'true'::jsonb, 6) ->> 'response',
  'true', 'technician answers the required checklist item'
);
reset role;
select ok(
  exists (select 1 from public.events where aggregate_id = '82050000-0000-4000-8000-000000000002' and event_type = 'checklist_item.responded'),
  'answering a checklist item appends a timeline event'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);
-- blocked completion: no photos yet
select throws_ok(
  $$select public.transition_work_order_safe('20000000-0000-4000-8000-000000000001', '82050000-0000-4000-8000-000000000002', 'completed', 6, statement_timestamp(), null, '完工摘要')$$,
  '23514', 'REQUIRED_EVIDENCE_MISSING', 'completion is blocked while a required evidence item lacks a ready photo'
);

-- pending photo does NOT count: upload before photo but do not verify it
select set_config('test.m5_before', (
  select public.create_photo_upload(
    '20000000-0000-4000-8000-000000000001', 'work_order', '82050000-0000-4000-8000-000000000002',
    'before', 'b.jpg', 'image/jpeg', 1000, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  ) ->> 'photoId'), true);
select throws_ok(
  $$select public.transition_work_order_safe('20000000-0000-4000-8000-000000000001', '82050000-0000-4000-8000-000000000002', 'completed', 6, statement_timestamp(), null, '完工摘要')$$,
  '23514', 'REQUIRED_EVIDENCE_MISSING', 'a pending (unverified) before photo does not satisfy the evidence gate'
);

-- verify the before photo; mismatched sha is rejected
select throws_ok(
  $$select public.complete_work_order_photo('20000000-0000-4000-8000-000000000001', current_setting('test.m5_before')::uuid, 'image/jpeg', 1000, 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc', 100, 100, null)$$,
  '42501', 'PHOTO_VERIFICATION_MISMATCH', 'a photo whose actual sha differs from the declared value is rejected'
);
select is(
  public.complete_work_order_photo('20000000-0000-4000-8000-000000000001', current_setting('test.m5_before')::uuid, 'image/jpeg', 1000, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 100, 100, null) ->> 'status',
  'ready', 'a matching verification marks the before photo ready'
);

-- after photo also serves as the checklist-item evidence
select set_config('test.m5_after', (
  select public.create_photo_upload(
    '20000000-0000-4000-8000-000000000001', 'work_order', '82050000-0000-4000-8000-000000000002',
    'after', 'a.jpg', 'image/jpeg', 1000, 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    current_setting('test.m5_item')::uuid
  ) ->> 'photoId'), true);
select is(
  public.complete_work_order_photo('20000000-0000-4000-8000-000000000001', current_setting('test.m5_after')::uuid, 'image/jpeg', 1000, 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 100, 100, null) ->> 'status',
  'ready', 'a matching verification marks the after/evidence photo ready'
);

reset role;
select set_config('test.m5_after_lv', (select lock_version::text from public.photos where id = current_setting('test.m5_after')::uuid), true);
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);
-- delete of the sole completion evidence is blocked
select throws_ok(
  $$select public.delete_work_order_photo('20000000-0000-4000-8000-000000000001', current_setting('test.m5_after')::uuid, current_setting('test.m5_after_lv')::integer, null)$$,
  '23514', 'PHOTO_IS_COMPLETION_EVIDENCE', 'the only ready evidence photo cannot be soft-deleted'
);

-- complete the checklist
select is(
  public.complete_work_order_checklist('20000000-0000-4000-8000-000000000001', current_setting('test.m5_cl')::uuid, 6, null) ->> 'status',
  'completed', 'the checklist completes once required items are answered with evidence'
);

-- blocked completion: still missing a non-empty summary
select throws_ok(
  $$select public.transition_work_order_safe('20000000-0000-4000-8000-000000000001', '82050000-0000-4000-8000-000000000002', 'completed', 6, statement_timestamp(), null, '   ')$$,
  '23514', 'COMPLETION_SUMMARY_REQUIRED', 'completion is blocked without a non-empty summary'
);

-- happy path completion
select is(
  public.transition_work_order_safe('20000000-0000-4000-8000-000000000001', '82050000-0000-4000-8000-000000000002', 'completed', 6, statement_timestamp(), null, '兩台冷氣清洗完成') ->> 'status',
  'completed', 'the work order completes once every gate is satisfied'
);
reset role;
select is(
  (select customer_signed_at from public.work_orders where id = '82050000-0000-4000-8000-000000000002'),
  null, 'a normal completion never fabricates a customer signature'
);

------------------------------------------------------------------------------
-- Force-complete: owner-only, reason required, distinct event, no signature
------------------------------------------------------------------------------

-- fresh scheduled WO with a checklist snapshot but no evidence/photos
insert into public.work_orders (
  id, organization_id, work_order_no, customer_id, location_id, title, status,
  scheduled_start_at, scheduled_end_at, lock_version, created_by, updated_by
) values (
  '82050000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000001',
  'W-M5-0003', '40000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000001', 'M5 例外完工工單', 'scheduled',
  '2026-09-05 01:00:00+00', '2026-09-05 03:00:00+00', 1,
  '10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002'
);
insert into public.assignments (
  id, organization_id, work_order_id, membership_id, duty, status, assigned_by, created_by, updated_by
) values (
  '83050000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000001',
  '82050000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000003',
  'lead', 'assigned', '10000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002'
);
insert into public.work_order_checklists (
  id, organization_id, work_order_id, name, status, created_by, updated_by
) values (
  '84050000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000001',
  '82050000-0000-4000-8000-000000000003', 'cl', 'pending',
  '10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002'
);

set local role authenticated;
-- march to on_site: dispatched (1->2), en_route (2->3), on_site (3->4)
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
select public.transition_work_order_safe('20000000-0000-4000-8000-000000000001', '82050000-0000-4000-8000-000000000003', 'dispatched', 1, statement_timestamp());
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);
select public.transition_work_order_safe('20000000-0000-4000-8000-000000000001', '82050000-0000-4000-8000-000000000003', 'en_route', 2, statement_timestamp());
select public.transition_work_order_safe('20000000-0000-4000-8000-000000000001', '82050000-0000-4000-8000-000000000003', 'on_site', 3, statement_timestamp());

-- technician cannot force-complete
select throws_ok(
  $$select public.force_complete_work_order('20000000-0000-4000-8000-000000000001', '82050000-0000-4000-8000-000000000003', 'reason', 'summary', 4, statement_timestamp(), null, null)$$,
  '42501', 'FORCE_COMPLETE_REQUIRES_OWNER', 'a technician cannot force-complete'
);
-- dispatcher cannot force-complete
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
select throws_ok(
  $$select public.force_complete_work_order('20000000-0000-4000-8000-000000000001', '82050000-0000-4000-8000-000000000003', 'reason', 'summary', 4, statement_timestamp(), null, null)$$,
  '42501', 'FORCE_COMPLETE_REQUIRES_OWNER', 'a dispatcher cannot force-complete'
);
-- owner force-complete without reason is rejected
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select throws_ok(
  $$select public.force_complete_work_order('20000000-0000-4000-8000-000000000001', '82050000-0000-4000-8000-000000000003', '  ', 'summary', 4, statement_timestamp(), null, null)$$,
  '23514', 'FORCE_COMPLETE_REASON_REQUIRED', 'owner force-complete demands a reason'
);
-- owner force-complete succeeds
select is(
  public.force_complete_work_order('20000000-0000-4000-8000-000000000001', '82050000-0000-4000-8000-000000000003', '客戶不在現場，改由店家代簽收', '已完成並拍照存證', 4, statement_timestamp(), null, null) ->> 'status',
  'completed', 'owner force-completes past the gate with a reason'
);
reset role;
-- distinct event, not a normal completion, and no customer signature
select is(
  (select event_type from public.events where aggregate_id = '82050000-0000-4000-8000-000000000003' order by chain_sequence desc limit 1),
  'work_order.force_completed', 'force-complete records a DISTINCT force_completed event'
);
select ok(
  not exists (select 1 from public.events where aggregate_id = '82050000-0000-4000-8000-000000000003' and event_type = 'work_order.completed'),
  'force-complete does not masquerade as a normal completion event'
);
select is(
  (select customer_signed_at from public.work_orders where id = '82050000-0000-4000-8000-000000000003'),
  null, 'force-complete never sets customer_signed_at'
);

------------------------------------------------------------------------------
-- Snapshot freeze: completed work order rejects further checklist/photo writes
------------------------------------------------------------------------------

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
select throws_ok(
  $$select public.create_work_order_checklist('20000000-0000-4000-8000-000000000001', '82050000-0000-4000-8000-000000000003', 'late', '[{"label":"y","responseType":"boolean"}]'::jsonb, null)$$,
  '23514', 'WORK_ORDER_NOT_EDITABLE', 'a completed work order rejects new checklists'
);

------------------------------------------------------------------------------
-- Photo authorization: an unassigned technician cannot mint a read URL
------------------------------------------------------------------------------

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000004', true);
select throws_ok(
  $$select public.get_work_order_photo_read_url('20000000-0000-4000-8000-000000000001', current_setting('test.m5_after')::uuid)$$,
  '42501', 'FORBIDDEN', 'an unassigned technician cannot mint a photo read URL'
);
-- an assigned technician can
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);
select is(
  (public.get_work_order_photo_read_url('20000000-0000-4000-8000-000000000001', current_setting('test.m5_after')::uuid) ->> 'expiresInSeconds')::integer,
  300, 'an assigned technician receives a short-lived read authorization'
);

------------------------------------------------------------------------------
-- Cross-tenant photo verification is a 404
------------------------------------------------------------------------------

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000005', true);
select throws_ok(
  $$select public.complete_work_order_photo('20000000-0000-4000-8000-000000000002', current_setting('test.m5_after')::uuid, 'image/jpeg', 1000, 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 100, 100, null)$$,
  'P0002', 'PHOTO_NOT_FOUND', 'a cross-tenant photo verify returns 404 with no leak'
);

reset role;

------------------------------------------------------------------------------
-- Photo-type required checklist gate (202607190006). A response_type='photo'
-- required item has no textual response -- its answer IS the uploaded photo --
-- so it must count as answered once it has a ready, non-deleted linked photo.
-- The authoritative DB gate must never deadlock even if a best-effort client
-- respond write never lands. Fresh WO ..0004 in Alpha, marched to on_site with
-- a ready before photo and a ready after photo (the after photo doubles as the
-- checklist-item's linked evidence).
------------------------------------------------------------------------------

insert into public.work_orders (
  id, organization_id, work_order_no, customer_id, location_id, title, status,
  scheduled_start_at, scheduled_end_at, lock_version, created_by, updated_by
) values (
  '82050000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000001',
  'W-M5-0004', '40000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000001', 'M5 照片檢查項完工工單', 'scheduled',
  '2026-09-08 01:00:00+00', '2026-09-08 03:00:00+00', 1,
  '10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002'
);
insert into public.assignments (
  id, organization_id, work_order_id, membership_id, duty, status, assigned_by, created_by, updated_by
) values (
  '83050000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000001',
  '82050000-0000-4000-8000-000000000004', '30000000-0000-4000-8000-000000000003',
  'lead', 'assigned', '10000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002'
);

set local role authenticated;
-- march to on_site: dispatched (1->2), en_route (2->3), on_site (3->4)
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
select public.transition_work_order_safe('20000000-0000-4000-8000-000000000001', '82050000-0000-4000-8000-000000000004', 'dispatched', 1, statement_timestamp());
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);
select public.transition_work_order_safe('20000000-0000-4000-8000-000000000001', '82050000-0000-4000-8000-000000000004', 'en_route', 2, statement_timestamp());
select public.transition_work_order_safe('20000000-0000-4000-8000-000000000001', '82050000-0000-4000-8000-000000000004', 'on_site', 3, statement_timestamp());

-- a REQUIRED photo-type checklist item (not evidence_required, so the photo-item
-- rule -- not the evidence gate -- is what governs completion here). Checklist
-- creation is a manager action, so switch to the dispatcher.
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
select set_config('test.m5_photocl', (
  select public.create_work_order_checklist(
    '20000000-0000-4000-8000-000000000001', '82050000-0000-4000-8000-000000000004',
    '拍照存證', '[{"label":"拍下室外機清洗後狀態","responseType":"photo","isRequired":true,"evidenceRequired":false}]'::jsonb, null
  ) ->> 'checklistId'), true);
reset role;
select set_config('test.m5_photoitem', (
  select id::text from public.work_order_checklist_items
  where work_order_checklist_id = current_setting('test.m5_photocl')::uuid), true);

-- a ready before photo (satisfies the before/after gate's "before" leg)
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);
select set_config('test.m5_pbefore', (
  select public.create_photo_upload(
    '20000000-0000-4000-8000-000000000001', 'work_order', '82050000-0000-4000-8000-000000000004',
    'before', 'pb.jpg', 'image/jpeg', 1000, 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd'
  ) ->> 'photoId'), true);
select public.complete_work_order_photo('20000000-0000-4000-8000-000000000001', current_setting('test.m5_pbefore')::uuid, 'image/jpeg', 1000, 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd', 100, 100, null);

-- an after photo LINKED to the photo checklist item (doubles as after-leg +
-- the item's answering evidence), uploaded but NOT yet verified (pending).
select set_config('test.m5_pafter', (
  select public.create_photo_upload(
    '20000000-0000-4000-8000-000000000001', 'work_order', '82050000-0000-4000-8000-000000000004',
    'after', 'pa.jpg', 'image/jpeg', 1000, 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    current_setting('test.m5_photoitem')::uuid
  ) ->> 'photoId'), true);

-- NEGATIVE: with the linked photo still PENDING (not ready) and no textual
-- response, the required photo item is unanswered -> completion is blocked. This
-- is the deadlock the old `response is null` gate would ALSO raise, but for the
-- wrong reason; the new rule keeps it blocked while evidence is not yet ready.
reset role;
select is(
  (select response from public.work_order_checklist_items where id = current_setting('test.m5_photoitem')::uuid),
  null, 'the photo checklist item carries NO textual response (its answer is the photo)'
);
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);
select throws_ok(
  $$select public.transition_work_order_safe('20000000-0000-4000-8000-000000000001', '82050000-0000-4000-8000-000000000004', 'completed', 4, statement_timestamp(), null, '室外機清洗完成')$$,
  '23514', 'REQUIRED_CHECKLIST_INCOMPLETE', 'a required photo item with only a PENDING linked photo still blocks completion'
);
-- complete_work_order_checklist honors the same rule while the photo is pending
select throws_ok(
  $$select public.complete_work_order_checklist('20000000-0000-4000-8000-000000000001', current_setting('test.m5_photocl')::uuid, 4, null)$$,
  '23514', 'REQUIRED_CHECKLIST_INCOMPLETE', 'complete_work_order_checklist blocks while the required photo item has only a pending photo'
);

-- verify (mark ready) the linked after photo -> the photo item is now answered
select is(
  public.complete_work_order_photo('20000000-0000-4000-8000-000000000001', current_setting('test.m5_pafter')::uuid, 'image/jpeg', 1000, 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', 100, 100, null) ->> 'status',
  'ready', 'the linked after photo is verified ready'
);

-- POSITIVE: complete_work_order_checklist now succeeds for the photo item with a
-- ready linked photo and NO textual response (previously impossible to satisfy).
select is(
  public.complete_work_order_checklist('20000000-0000-4000-8000-000000000001', current_setting('test.m5_photocl')::uuid, 4, null) ->> 'status',
  'completed', 'complete_work_order_checklist completes a photo-only checklist once its linked photo is ready'
);

-- POSITIVE: the whole work order now completes via transition_work_order even
-- though the required photo item never received a textual response -- the ready
-- linked photo is the authoritative answer, so the gate no longer deadlocks.
select is(
  public.transition_work_order_safe('20000000-0000-4000-8000-000000000001', '82050000-0000-4000-8000-000000000004', 'completed', 4, statement_timestamp(), null, '室外機清洗完成') ->> 'status',
  'completed', 'a required photo checklist item is satisfied by a ready linked photo (no textual response needed)'
);

------------------------------------------------------------------------------
-- Soft-deleted linked photo does NOT satisfy the photo item. Fresh WO ..0005
-- reaches on_site with a ready before + ready after photo; the photo item's
-- linked photo is then soft-deleted, so completion must stay blocked.
------------------------------------------------------------------------------

reset role;
insert into public.work_orders (
  id, organization_id, work_order_no, customer_id, location_id, title, status,
  scheduled_start_at, scheduled_end_at, lock_version, created_by, updated_by
) values (
  '82050000-0000-4000-8000-000000000005', '20000000-0000-4000-8000-000000000001',
  'W-M5-0005', '40000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000001', 'M5 照片刪除仍阻擋完工工單', 'scheduled',
  '2026-09-09 01:00:00+00', '2026-09-09 03:00:00+00', 1,
  '10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002'
);
insert into public.assignments (
  id, organization_id, work_order_id, membership_id, duty, status, assigned_by, created_by, updated_by
) values (
  '83050000-0000-4000-8000-000000000005', '20000000-0000-4000-8000-000000000001',
  '82050000-0000-4000-8000-000000000005', '30000000-0000-4000-8000-000000000003',
  'lead', 'assigned', '10000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
select public.transition_work_order_safe('20000000-0000-4000-8000-000000000001', '82050000-0000-4000-8000-000000000005', 'dispatched', 1, statement_timestamp());
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);
select public.transition_work_order_safe('20000000-0000-4000-8000-000000000001', '82050000-0000-4000-8000-000000000005', 'en_route', 2, statement_timestamp());
select public.transition_work_order_safe('20000000-0000-4000-8000-000000000001', '82050000-0000-4000-8000-000000000005', 'on_site', 3, statement_timestamp());

-- required photo item + one required TEXT item (to exercise the unchanged rule
-- too). Checklist creation is a manager action, so switch to the dispatcher.
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
select set_config('test.m5_delcl', (
  select public.create_work_order_checklist(
    '20000000-0000-4000-8000-000000000001', '82050000-0000-4000-8000-000000000005',
    '刪除測試', '[{"label":"完工照","responseType":"photo","isRequired":true,"evidenceRequired":false},{"label":"備註","responseType":"text","isRequired":true,"evidenceRequired":false}]'::jsonb, null
  ) ->> 'checklistId'), true);
reset role;
select set_config('test.m5_delphotoitem', (
  select id::text from public.work_order_checklist_items
  where work_order_checklist_id = current_setting('test.m5_delcl')::uuid and response_type = 'photo'), true);
select set_config('test.m5_deltextitem', (
  select id::text from public.work_order_checklist_items
  where work_order_checklist_id = current_setting('test.m5_delcl')::uuid and response_type = 'text'), true);

-- ready before + ready after photos; the after photo links the photo item
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);
select set_config('test.m5_delbefore', (
  select public.create_photo_upload(
    '20000000-0000-4000-8000-000000000001', 'work_order', '82050000-0000-4000-8000-000000000005',
    'before', 'db.jpg', 'image/jpeg', 1000, '1111111111111111111111111111111111111111111111111111111111111111'
  ) ->> 'photoId'), true);
select public.complete_work_order_photo('20000000-0000-4000-8000-000000000001', current_setting('test.m5_delbefore')::uuid, 'image/jpeg', 1000, '1111111111111111111111111111111111111111111111111111111111111111', 100, 100, null);
select set_config('test.m5_delafter', (
  select public.create_photo_upload(
    '20000000-0000-4000-8000-000000000001', 'work_order', '82050000-0000-4000-8000-000000000005',
    'after', 'da.jpg', 'image/jpeg', 1000, '2222222222222222222222222222222222222222222222222222222222222222',
    current_setting('test.m5_delphotoitem')::uuid
  ) ->> 'photoId'), true);
select public.complete_work_order_photo('20000000-0000-4000-8000-000000000001', current_setting('test.m5_delafter')::uuid, 'image/jpeg', 1000, '2222222222222222222222222222222222222222222222222222222222222222', 100, 100, null);

-- UNCHANGED RULE: the required TEXT item still has a null response, so completion
-- is blocked for a NON-photo item exactly as before.
select throws_ok(
  $$select public.transition_work_order_safe('20000000-0000-4000-8000-000000000001', '82050000-0000-4000-8000-000000000005', 'completed', 4, statement_timestamp(), null, '完工')$$,
  '23514', 'REQUIRED_CHECKLIST_INCOMPLETE', 'a required text item with a null response still blocks completion (unchanged rule)'
);

-- answer the text item so only the photo item governs the next assertions
select public.respond_to_checklist_item('20000000-0000-4000-8000-000000000001', current_setting('test.m5_deltextitem')::uuid, '"已清洗兩台"'::jsonb, 4);

-- soft-delete the sole linked photo directly (superuser bypasses the RPC guard)
reset role;
update public.photos set deleted_at = now(), status = 'deleted'
where id = current_setting('test.m5_delafter')::uuid;

-- upload+ready a plain after photo so the before/after gate is still satisfied
-- (it is NOT linked to the photo item, so it cannot answer it)
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);
select set_config('test.m5_delafter2', (
  select public.create_photo_upload(
    '20000000-0000-4000-8000-000000000001', 'work_order', '82050000-0000-4000-8000-000000000005',
    'after', 'da2.jpg', 'image/jpeg', 1000, '3333333333333333333333333333333333333333333333333333333333333333'
  ) ->> 'photoId'), true);
select public.complete_work_order_photo('20000000-0000-4000-8000-000000000001', current_setting('test.m5_delafter2')::uuid, 'image/jpeg', 1000, '3333333333333333333333333333333333333333333333333333333333333333', 100, 100, null);

-- NEGATIVE: the photo item's only linked photo is soft-deleted, so the required
-- photo item is unanswered again and completion stays blocked.
select throws_ok(
  $$select public.transition_work_order_safe('20000000-0000-4000-8000-000000000001', '82050000-0000-4000-8000-000000000005', 'completed', 4, statement_timestamp(), null, '完工')$$,
  '23514', 'REQUIRED_CHECKLIST_INCOMPLETE', 'a required photo item whose only linked photo is soft-deleted still blocks completion'
);
-- complete_work_order_checklist agrees the checklist is not answered
select throws_ok(
  $$select public.complete_work_order_checklist('20000000-0000-4000-8000-000000000001', current_setting('test.m5_delcl')::uuid, 4, null)$$,
  '23514', 'REQUIRED_CHECKLIST_INCOMPLETE', 'complete_work_order_checklist blocks while the photo item has only a soft-deleted photo'
);

reset role;

select * from finish();
rollback;
