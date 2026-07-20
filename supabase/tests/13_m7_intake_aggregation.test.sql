begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(66);

------------------------------------------------------------------------------
-- M7 — free-form LINE message aggregation into human-confirmed intake drafts,
-- with an AI-extractor seam whose failure NEVER blocks intake.
--
-- Shared seed provides:
--   Org Alpha 20..0001: owner user 10..0001 (membership 30..0001),
--     dispatcher user 10..0002, technician user 10..0003.
--     LINE channel a1c0..0001, customer identity a1de..0001
--     (line_user_id = 'Uline-alpha-customer-0001'), processed webhook a1eb..0001.
--   Org Beta  20..0002: owner user 10..0005. LINE channel b1c0..0001.
--
-- Direct table reads require superuser (authenticated has no base-table grant
-- for writes; SELECT is RLS-scoped). Worker RPCs are service_role only; staff
-- RPCs (confirm/dismiss) are authenticated with an internal role gate.
------------------------------------------------------------------------------

-- Deterministic org/channel/identity ids.
\set alpha_org      '\'20000000-0000-4000-8000-000000000001\''
\set beta_org       '\'20000000-0000-4000-8000-000000000002\''
\set alpha_channel  '\'a1c00000-0000-4000-8000-000000000001\''
\set beta_channel   '\'b1c00000-0000-4000-8000-000000000001\''
\set alpha_identity '\'a1de0000-0000-4000-8000-000000000001\''
\set alpha_webhook  '\'a1eb0000-0000-4000-8000-000000000001\''

------------------------------------------------------------------------------
-- 1. Schema: five M7 tables force RLS and expose no direct mutation grants.
------------------------------------------------------------------------------

select ok(
  (select relforcerowsecurity from pg_class where oid = 'public.conversations'::regclass),
  'conversations forces RLS'
);
select ok(
  (select relforcerowsecurity from pg_class where oid = 'public.inbound_messages'::regclass),
  'inbound_messages forces RLS'
);
select ok(
  (select relforcerowsecurity from pg_class where oid = 'public.message_attachments'::regclass),
  'message_attachments forces RLS'
);
select ok(
  (select relforcerowsecurity from pg_class where oid = 'public.intake_drafts'::regclass),
  'intake_drafts forces RLS'
);
select ok(
  (select relforcerowsecurity from pg_class where oid = 'public.intake_extraction_runs'::regclass),
  'intake_extraction_runs forces RLS'
);

select ok(not has_table_privilege('authenticated', 'public.conversations', 'INSERT'), 'authenticated cannot forge conversations');
select ok(not has_table_privilege('authenticated', 'public.conversations', 'UPDATE'), 'authenticated cannot rewrite conversations');
select ok(not has_table_privilege('authenticated', 'public.inbound_messages', 'INSERT'), 'authenticated cannot forge inbound messages');
select ok(not has_table_privilege('authenticated', 'public.inbound_messages', 'UPDATE'), 'authenticated cannot rewrite inbound messages');
select ok(not has_table_privilege('authenticated', 'public.intake_drafts', 'INSERT'), 'authenticated cannot forge drafts');
select ok(not has_table_privilege('authenticated', 'public.intake_drafts', 'UPDATE'), 'authenticated draft changes require the RPCs');
select ok(not has_table_privilege('authenticated', 'public.intake_extraction_runs', 'INSERT'), 'authenticated cannot forge extraction runs');
select ok(has_table_privilege('authenticated', 'public.intake_drafts', 'SELECT'), 'authenticated may read drafts (RLS-scoped) for the inbox');
select ok(has_table_privilege('authenticated', 'public.conversations', 'SELECT'), 'authenticated may read conversations (RLS-scoped)');
select ok(not has_table_privilege('anon', 'public.intake_drafts', 'SELECT'), 'anon cannot read drafts');

------------------------------------------------------------------------------
-- 2. RPC grant boundary.
------------------------------------------------------------------------------

select ok(has_function_privilege('service_role', 'public.ingest_inbound_message(uuid,text,text,text,jsonb,text,uuid,timestamptz)', 'EXECUTE'), 'service_role may ingest inbound messages');
select ok(not has_function_privilege('authenticated', 'public.ingest_inbound_message(uuid,text,text,text,jsonb,text,uuid,timestamptz)', 'EXECUTE'), 'authenticated cannot ingest inbound messages');
select ok(has_function_privilege('service_role', 'public.record_extraction_run(uuid,uuid,text,text,uuid[],text,numeric,text,text,jsonb,text[],jsonb,text,integer)', 'EXECUTE'), 'service_role may record extraction runs');
select ok(not has_function_privilege('authenticated', 'public.record_extraction_run(uuid,uuid,text,text,uuid[],text,numeric,text,text,jsonb,text[],jsonb,text,integer)', 'EXECUTE'), 'authenticated cannot record extraction runs');
select ok(has_function_privilege('service_role', 'public.claim_intake_extraction_runs(text,integer,timestamptz)', 'EXECUTE'), 'service_role may claim extraction work');
select ok(not has_function_privilege('authenticated', 'public.claim_intake_extraction_runs(text,integer,timestamptz)', 'EXECUTE'), 'authenticated cannot claim extraction work');
select ok(has_function_privilege('authenticated', 'public.confirm_intake_draft(uuid,uuid,integer,text,jsonb)', 'EXECUTE'), 'authenticated (role gate internal) may confirm a draft');
select ok(not has_function_privilege('service_role', 'public.confirm_intake_draft(uuid,uuid,integer,text,jsonb)', 'EXECUTE'), 'confirm is not a service_role path');
select ok(has_function_privilege('authenticated', 'public.dismiss_intake_draft(uuid,uuid,integer,text)', 'EXECUTE'), 'authenticated (role gate internal) may dismiss a draft');

------------------------------------------------------------------------------
-- 3. Aggregation: two messages from ONE sender coalesce into ONE conversation.
------------------------------------------------------------------------------

set local role service_role;

select is(
  public.ingest_inbound_message(
    :alpha_webhook, 'line-msg-0001', 'text', '冷氣不冷了，可以來看嗎',
    '{"type":"message","message":{"id":"line-msg-0001","type":"text","text":"冷氣不冷了"}}'::jsonb,
    'Uline-alpha-customer-0001', :alpha_identity, '2026-07-20 03:00:00+00'
  ) ->> 'duplicate', 'false', 'first message from a sender lands (not a duplicate)'
);

select is(
  public.ingest_inbound_message(
    :alpha_webhook, 'line-msg-0002', 'text', '在內湖，明天下午方便',
    '{"type":"message","message":{"id":"line-msg-0002","type":"text","text":"在內湖"}}'::jsonb,
    'Uline-alpha-customer-0001', :alpha_identity, '2026-07-20 03:01:00+00'
  ) ->> 'duplicate', 'false', 'a consecutive message from the same sender also lands'
);

reset role;

select is(
  (select count(*)::integer from public.conversations
   where organization_id = :alpha_org and line_user_id = 'Uline-alpha-customer-0001' and status = 'open'),
  1, 'two messages from one sender produce exactly ONE open conversation'
);

select is(
  (select message_count from public.conversations
   where organization_id = :alpha_org and line_user_id = 'Uline-alpha-customer-0001' and status = 'open'),
  2, 'the open conversation aggregates both messages (message_count = 2)'
);

select is(
  (select count(*)::integer from public.inbound_messages im
   join public.conversations c on c.id = im.conversation_id
   where c.organization_id = :alpha_org and c.line_user_id = 'Uline-alpha-customer-0001'),
  2, 'both inbound messages hang off the single conversation'
);

------------------------------------------------------------------------------
-- 4. Dedup: replaying the same line_message_id does not create a second row.
------------------------------------------------------------------------------

set local role service_role;

select is(
  public.ingest_inbound_message(
    :alpha_webhook, 'line-msg-0001', 'text', '冷氣不冷了，可以來看嗎',
    '{"type":"message","message":{"id":"line-msg-0001","type":"text","text":"冷氣不冷了"}}'::jsonb,
    'Uline-alpha-customer-0001', :alpha_identity, '2026-07-20 03:00:00+00'
  ) ->> 'duplicate', 'true', 'replaying the same line_message_id is reported as a duplicate'
);

reset role;

select is(
  (select count(*)::integer from public.inbound_messages
   where organization_id = :alpha_org and line_message_id = 'line-msg-0001'),
  1, 'a replayed line_message_id does not create a second inbound message'
);
select is(
  (select message_count from public.conversations
   where organization_id = :alpha_org and line_user_id = 'Uline-alpha-customer-0001' and status = 'open'),
  2, 'the dedup replay does not bump message_count'
);

------------------------------------------------------------------------------
-- 5. Append-only: inbound_messages.raw / text_content are write-once.
------------------------------------------------------------------------------

select throws_ok(
  $$update public.inbound_messages set raw = '{"tampered":true}'::jsonb
    where line_message_id = 'line-msg-0001'$$,
  'P0001', 'INBOUND_MESSAGE_IMMUTABLE',
  'inbound_messages.raw is write-once (guard trigger rejects the update)'
);
select throws_ok(
  $$update public.inbound_messages set text_content = 'rewritten'
    where line_message_id = 'line-msg-0001'$$,
  'P0001', 'INBOUND_MESSAGE_IMMUTABLE',
  'inbound_messages.text_content is write-once'
);

------------------------------------------------------------------------------
-- 6. AI success: an extraction run writes ONE origin='ai' draft + audit run.
--    Capture ids under superuser (service_role has no base-table SELECT grant).
------------------------------------------------------------------------------

select id as alpha_conv_id from public.conversations
  where organization_id = :alpha_org and line_user_id = 'Uline-alpha-customer-0001' and status = 'open'
\gset
select array_agg(im.id) as alpha_msg_ids from public.inbound_messages im
  join public.conversations c on c.id = im.conversation_id
  where c.organization_id = :alpha_org and c.line_user_id = 'Uline-alpha-customer-0001'
\gset

set local role service_role;

select is(
  public.record_extraction_run(
    :alpha_org, :'alpha_conv_id', 'fake', 'succeeded', :'alpha_msg_ids',
    'fake-1', 0.82,
    '客戶冷氣不冷，位於內湖，希望明天下午到府', '冷氣維修 · 內湖',
    '{"contactName":{"value":"示範客戶 A","source":"ai","confidence":0.7},"subject":{"value":"冷氣維修","source":"ai","confidence":0.9},"category":{"value":"cooling","source":"ai","confidence":0.85}}'::jsonb,
    array['contactPhone']::text[], null, null
  ) ->> 'origin', 'ai', 'a succeeded extraction yields an origin=ai draft'
);

reset role;

select is(
  (select count(*)::integer from public.intake_drafts d
   join public.conversations c on c.id = d.conversation_id
   where c.organization_id = :alpha_org and c.line_user_id = 'Uline-alpha-customer-0001'
     and d.status = 'pending_review'),
  1, 'the AI extraction produces exactly ONE active draft for the conversation'
);
select is(
  (select origin from public.intake_drafts d
   join public.conversations c on c.id = d.conversation_id
   where c.organization_id = :alpha_org and c.line_user_id = 'Uline-alpha-customer-0001'
     and d.status = 'pending_review'),
  'ai', 'the active draft is origin=ai with source-tagged fields'
);
select is(
  (select confidence from public.intake_drafts d
   join public.conversations c on c.id = d.conversation_id
   where c.organization_id = :alpha_org and c.line_user_id = 'Uline-alpha-customer-0001'
     and d.status = 'pending_review')::text,
  '0.820', 'the draft carries overall confidence (source + confidence gate)'
);
select is(
  (select d.fields #>> '{subject,source}' from public.intake_drafts d
   join public.conversations c on c.id = d.conversation_id
   where c.organization_id = :alpha_org and c.line_user_id = 'Uline-alpha-customer-0001'
     and d.status = 'pending_review'),
  'ai', 'each draft field carries its provenance source (show-source gate)'
);
select is(
  (select r.status from public.intake_extraction_runs r
   join public.conversations c on c.id = r.conversation_id
   where c.organization_id = :alpha_org and c.line_user_id = 'Uline-alpha-customer-0001'
   order by r.started_at desc limit 1),
  'succeeded', 'the extraction run is audited as succeeded'
);

------------------------------------------------------------------------------
-- 7. DEGRADATION GATE: a FAILED extraction still leaves a draft (origin=manual),
--    and the inbound messages are still fully intact. AI failure MUST NOT block.
------------------------------------------------------------------------------

-- A fresh sender whose extraction fails.
set local role service_role;

select public.ingest_inbound_message(
  :alpha_webhook, 'line-msg-fail-01', 'text', '樓上漏水到我家天花板',
  '{"type":"message","message":{"id":"line-msg-fail-01","type":"text","text":"漏水"}}'::jsonb,
  'Uline-alpha-degraded-0001', null, '2026-07-20 04:00:00+00'
);

reset role;

select id as degraded_conv_id from public.conversations
  where organization_id = :alpha_org and line_user_id = 'Uline-alpha-degraded-0001' and status = 'open'
\gset
select array_agg(im.id) as degraded_msg_ids from public.inbound_messages im
  join public.conversations c on c.id = im.conversation_id
  where c.organization_id = :alpha_org and c.line_user_id = 'Uline-alpha-degraded-0001'
\gset

set local role service_role;

select is(
  public.mark_extraction_failed(
    :alpha_org, :'degraded_conv_id', 'fake', :'degraded_msg_ids', 'AI_UNAVAILABLE', 1200
  ) ->> 'origin', 'manual',
  'a FAILED extraction degrades to an origin=manual draft (degradation gate)'
);

reset role;

select is(
  (select count(*)::integer from public.intake_drafts d
   join public.conversations c on c.id = d.conversation_id
   where c.organization_id = :alpha_org and c.line_user_id = 'Uline-alpha-degraded-0001'
     and d.status = 'pending_review' and d.origin = 'manual'),
  1, 'AI failure STILL creates a pending manual draft — the message is never lost'
);
select is(
  (select r.status from public.intake_extraction_runs r
   join public.conversations c on c.id = r.conversation_id
   where c.organization_id = :alpha_org and c.line_user_id = 'Uline-alpha-degraded-0001'
   order by r.started_at desc limit 1),
  'failed', 'the failed extraction is audited (status=failed) for observability'
);
select is(
  (select r.confidence from public.intake_extraction_runs r
   join public.conversations c on c.id = r.conversation_id
   where c.organization_id = :alpha_org and c.line_user_id = 'Uline-alpha-degraded-0001'
   order by r.started_at desc limit 1),
  null, 'a failed run records no confidence'
);
select is(
  (select summary from public.intake_drafts d
   join public.conversations c on c.id = d.conversation_id
   where c.organization_id = :alpha_org and c.line_user_id = 'Uline-alpha-degraded-0001'
     and d.status = 'pending_review'),
  null, 'the degraded manual draft has an empty AI summary'
);
select is(
  (select text_content from public.inbound_messages
   where organization_id = :alpha_org and line_message_id = 'line-msg-fail-01'),
  '樓上漏水到我家天花板',
  'the original inbound message text survives the AI failure fully intact'
);

------------------------------------------------------------------------------
-- 8. One active draft per conversation: a second run supersedes in place.
------------------------------------------------------------------------------

set local role service_role;

select public.record_extraction_run(
  :alpha_org, :'alpha_conv_id', 'fake', 'succeeded', :'alpha_msg_ids',
  'fake-1', 0.9, '更新後的摘要', '冷氣維修 · 內湖',
  '{"subject":{"value":"冷氣維修","source":"ai","confidence":0.9}}'::jsonb, null, null, null
);

reset role;

select is(
  (select count(*)::integer from public.intake_drafts d
   join public.conversations c on c.id = d.conversation_id
   where c.organization_id = :alpha_org and c.line_user_id = 'Uline-alpha-customer-0001'
     and d.status = 'pending_review'),
  1, 'a re-run keeps exactly ONE active draft per conversation (updated in place)'
);

------------------------------------------------------------------------------
-- 9. Staff confirm → creates a service_request source=line; confirm-once.
------------------------------------------------------------------------------

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);

select is(
  public.confirm_intake_draft(
    :alpha_org,
    (select d.id from public.intake_drafts d
       join public.conversations c on c.id = d.conversation_id
       where c.organization_id = :alpha_org and c.line_user_id = 'Uline-alpha-customer-0001'
         and d.status = 'pending_review'),
    (select d.lock_version from public.intake_drafts d
       join public.conversations c on c.id = d.conversation_id
       where c.organization_id = :alpha_org and c.line_user_id = 'Uline-alpha-customer-0001'
         and d.status = 'pending_review'),
    'idem-confirm-0001', null
  ) ->> 'status', 'new', 'confirm creates a service_request in status new'
);

reset role;

select is(
  (select count(*)::integer from public.service_requests
   where organization_id = :alpha_org and source = 'line'
     and source_reference = (
       select c.id::text from public.conversations c
       where c.organization_id = :alpha_org and c.line_user_id = 'Uline-alpha-customer-0001' limit 1
     )),
  1, 'confirm produced exactly one service_request with source=line'
);
select is(
  (select customer_line_identity_id from public.service_requests
   where organization_id = :alpha_org and source = 'line'
     and source_reference = (
       select c.id::text from public.conversations c
       where c.organization_id = :alpha_org and c.line_user_id = 'Uline-alpha-customer-0001' limit 1
     )),
  :alpha_identity, 'the service_request carries the customer LINE identity'
);
select is(
  (select status from public.conversations
   where organization_id = :alpha_org and line_user_id = 'Uline-alpha-customer-0001'),
  'drafted', 'the conversation moves to drafted after confirm'
);
select is(
  (select d.status from public.intake_drafts d
   join public.conversations c on c.id = d.conversation_id
   where c.organization_id = :alpha_org and c.line_user_id = 'Uline-alpha-customer-0001'
   order by d.updated_at desc limit 1),
  'confirmed', 'the draft is marked confirmed'
);
select is(
  (select original_submission ->> 'source' from public.service_requests
   where organization_id = :alpha_org and source = 'line'
     and source_reference = (
       select c.id::text from public.conversations c
       where c.organization_id = :alpha_org and c.line_user_id = 'Uline-alpha-customer-0001' limit 1
     )),
  'line', 'the immutable original_submission snapshot records the LINE source'
);
select ok(
  exists (
    select 1 from public.events
    where organization_id = :alpha_org and aggregate_type = 'intake_draft'
      and event_type = 'intake_draft.confirmed'
  ),
  'confirm appends an intake_draft.confirmed audit event'
);

-- Capture (under superuser) the confirmed draft id and the service_request id
-- so the replay assertions never read base tables as authenticated.
select d.id as confirmed_draft_id from public.intake_drafts d
  join public.conversations c on c.id = d.conversation_id
  where c.organization_id = :alpha_org and c.line_user_id = 'Uline-alpha-customer-0001'
    and d.status = 'confirmed' limit 1
\gset
select sr.id as line_sr_id from public.service_requests sr
  join public.conversations c on c.id::text = sr.source_reference
  where sr.organization_id = :alpha_org and sr.source = 'line'
    and c.line_user_id = 'Uline-alpha-customer-0001' limit 1
\gset

-- confirm-once: replaying confirm returns the SAME service_request.
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);

select is(
  public.confirm_intake_draft(
    :alpha_org, :'confirmed_draft_id', 999, 'idem-confirm-0001-replay', null
  ) ->> 'replayed', 'true', 'a repeated confirm on the same draft is an idempotent replay'
);

select is(
  public.confirm_intake_draft(
    :alpha_org, :'confirmed_draft_id', 999, 'idem-confirm-0001-replay2', null
  ) ->> 'serviceRequestId', :'line_sr_id'::text,
  'confirm-once returns the SAME service_request on replay'
);

reset role;

select is(
  (select count(*)::integer from public.service_requests
   where organization_id = :alpha_org and source = 'line'
     and source_reference = (
       select c.id::text from public.conversations c
       where c.organization_id = :alpha_org and c.line_user_id = 'Uline-alpha-customer-0001' limit 1
     )),
  1, 'no duplicate service_request is created on confirm replay'
);

------------------------------------------------------------------------------
-- 10. Tenant isolation: cross-tenant confirm and reads are rejected.
------------------------------------------------------------------------------

-- Beta owner cannot confirm an Alpha draft (dismiss the degraded Alpha draft
-- from Beta's org -> NOT_FOUND under Beta's tenant scope).
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000005', true);

select throws_ok(
  format(
    $q$select public.confirm_intake_draft(%L, %L, 1, 'x-tenant', null)$q$,
    '20000000-0000-4000-8000-000000000002',
    (select d.id from public.intake_drafts d
       join public.conversations c on c.id = d.conversation_id
       where c.organization_id = '20000000-0000-4000-8000-000000000001'
         and c.line_user_id = 'Uline-alpha-degraded-0001' and d.status = 'pending_review' limit 1)
  ),
  'P0002', 'INTAKE_DRAFT_NOT_FOUND',
  'a cross-tenant confirm cannot see the other org''s draft'
);

-- Beta owner (dispatcher on Beta) cannot confirm against Alpha's org id.
select throws_ok(
  format(
    $q$select public.confirm_intake_draft(%L, %L, 1, 'x-tenant2', null)$q$,
    '20000000-0000-4000-8000-000000000001',
    (select d.id from public.intake_drafts d
       join public.conversations c on c.id = d.conversation_id
       where c.organization_id = '20000000-0000-4000-8000-000000000001'
         and c.line_user_id = 'Uline-alpha-degraded-0001' and d.status = 'pending_review' limit 1)
  ),
  '42501', 'FORBIDDEN',
  'a user with no membership in the target org is forbidden from confirming'
);

-- Beta owner cannot SELECT Alpha's drafts via RLS.
select is(
  (select count(*)::integer from public.intake_drafts
   where organization_id = '20000000-0000-4000-8000-000000000001'),
  0, 'RLS hides another org''s drafts from an unrelated member'
);
select is(
  (select count(*)::integer from public.conversations
   where organization_id = '20000000-0000-4000-8000-000000000001'),
  0, 'RLS hides another org''s conversations'
);

reset role;

------------------------------------------------------------------------------
-- 11. Dismiss: a pending draft can be dismissed; conversation -> dismissed.
------------------------------------------------------------------------------

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);

select is(
  public.dismiss_intake_draft(
    :alpha_org,
    (select d.id from public.intake_drafts d
       join public.conversations c on c.id = d.conversation_id
       where c.organization_id = :alpha_org and c.line_user_id = 'Uline-alpha-degraded-0001'
         and d.status = 'pending_review'),
    (select d.lock_version from public.intake_drafts d
       join public.conversations c on c.id = d.conversation_id
       where c.organization_id = :alpha_org and c.line_user_id = 'Uline-alpha-degraded-0001'
         and d.status = 'pending_review'),
    'spam'
  ) ->> 'draftStatus', 'dismissed', 'dismiss marks the draft dismissed'
);

reset role;

select is(
  (select status from public.conversations
   where organization_id = :alpha_org and line_user_id = 'Uline-alpha-degraded-0001'),
  'dismissed', 'dismissing the only draft moves the conversation to dismissed'
);

------------------------------------------------------------------------------
-- 12. Confirm requires the confirmable state / lock version.
------------------------------------------------------------------------------

-- A dismissed draft is not confirmable.
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);

select throws_ok(
  format(
    $q$select public.confirm_intake_draft(%L, %L, 1, 'confirm-dismissed', null)$q$,
    '20000000-0000-4000-8000-000000000001',
    (select d.id from public.intake_drafts d
       join public.conversations c on c.id = d.conversation_id
       where c.organization_id = '20000000-0000-4000-8000-000000000001'
         and c.line_user_id = 'Uline-alpha-degraded-0001' and d.status = 'dismissed' limit 1)
  ),
  '23514', 'INTAKE_DRAFT_NOT_CONFIRMABLE',
  'a dismissed draft cannot be confirmed'
);

reset role;

------------------------------------------------------------------------------
-- 13. Extraction claim: an open conversation with no active draft is claimable;
--     a drafted conversation is not.
------------------------------------------------------------------------------

set local role service_role;

-- A brand-new open conversation with a message but no draft yet.
select public.ingest_inbound_message(
  :alpha_webhook, 'line-msg-claim-01', 'text', '想問洗冷氣多少錢',
  '{"type":"message","message":{"id":"line-msg-claim-01","type":"text","text":"洗冷氣"}}'::jsonb,
  'Uline-alpha-claimable-0001', null, '2026-07-20 05:00:00+00'
);

select ok(
  public.claim_intake_extraction_runs('ex-worker', 50, '2026-07-20 06:00:00+00')::jsonb @> jsonb_build_array(
    jsonb_build_object('lineUserId', 'Uline-alpha-claimable-0001')
  ) is not false
  and exists (
    select 1 from jsonb_array_elements(
      public.claim_intake_extraction_runs('ex-worker', 50, '2026-07-20 06:00:00+00')
    ) e
    where e ->> 'lineUserId' = 'Uline-alpha-claimable-0001'
  ),
  'an open conversation with a message and no active draft is claimable for extraction'
);

select ok(
  not exists (
    select 1 from jsonb_array_elements(
      public.claim_intake_extraction_runs('ex-worker', 50, '2026-07-20 06:00:00+00')
    ) e
    where e ->> 'lineUserId' = 'Uline-alpha-customer-0001'
  ),
  'a drafted (already-acted-on) conversation is NOT re-claimed for extraction'
);

reset role;

select * from finish();
rollback;
