begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(120);

------------------------------------------------------------------------------
-- M6 — LINE webhook ingestion + notification outbox + retry/kill-switch.
--
-- Shared seed provides:
--   Org Alpha 20..0001: owner user 10..0001 (membership 30..0001),
--     dispatcher user 10..0002 (membership 30..0002),
--     technician A user 10..0003 (membership 30..0003).
--   Org Beta  20..0002: owner user 10..0005 (membership 30..0005).
--
-- Direct table reads require superuser (authenticated has no table grants). The
-- worker/webhook RPCs are security-definer and callable only by service_role;
-- staff-facing RPCs by authenticated. Inspection runs under `reset role`.
------------------------------------------------------------------------------

-- LINE channels + credentials + a bound customer identity are provided by the
-- shared seed (Alpha active a1c0..0001, Beta active b1c0..0001, credential row,
-- customer identity a1de..0001, one processed webhook fixture a1eb..0001). The
-- one-active-per-org unique means this suite reuses those ids rather than
-- inserting fresh active channels.

------------------------------------------------------------------------------
-- 1. Grants / RPC boundary
------------------------------------------------------------------------------

select ok(has_function_privilege('service_role', 'public.ingest_line_webhook_event(uuid,text,text,timestamptz,jsonb,text)', 'EXECUTE'), 'service_role may ingest webhook events');
select ok(not has_function_privilege('authenticated', 'public.ingest_line_webhook_event(uuid,text,text,timestamptz,jsonb,text)', 'EXECUTE'), 'authenticated cannot ingest webhook events');
select ok(not has_function_privilege('anon', 'public.ingest_line_webhook_event(uuid,text,text,timestamptz,jsonb,text)', 'EXECUTE'), 'anon cannot ingest webhook events');

select ok(has_function_privilege('service_role', 'public.claim_line_webhook_events(text,integer,timestamptz)', 'EXECUTE'), 'service_role may claim webhook events');
select ok(not has_function_privilege('authenticated', 'public.claim_line_webhook_events(text,integer,timestamptz)', 'EXECUTE'), 'authenticated cannot claim webhook events');

select ok(has_function_privilege('service_role', 'public.mark_webhook_processed(uuid,text)', 'EXECUTE'), 'service_role may mark webhook processed');
select ok(has_function_privilege('service_role', 'public.mark_webhook_ignored(uuid,text)', 'EXECUTE'), 'service_role may mark webhook ignored');
select ok(has_function_privilege('service_role', 'public.mark_webhook_failed(uuid,text)', 'EXECUTE'), 'service_role may mark webhook failed');

select ok(has_function_privilege('service_role', 'public.claim_notifications(text,integer,timestamptz)', 'EXECUTE'), 'service_role may claim notifications');
select ok(not has_function_privilege('authenticated', 'public.claim_notifications(text,integer,timestamptz)', 'EXECUTE'), 'authenticated cannot claim notifications');
select ok(has_function_privilege('service_role', 'public.mark_notification_sent(uuid,text)', 'EXECUTE'), 'service_role may mark notification sent');
select ok(has_function_privilege('service_role', 'public.mark_notification_retry(uuid,text,timestamptz)', 'EXECUTE'), 'service_role may retry a notification');
select ok(has_function_privilege('service_role', 'public.mark_notification_failed(uuid,text)', 'EXECUTE'), 'service_role may fail a notification');
select ok(has_function_privilege('service_role', 'public.requeue_stale_notifications(timestamptz,integer)', 'EXECUTE'), 'service_role may run the watchdog');

select ok(not has_function_privilege('authenticated', 'private.enqueue_notification(uuid,text,uuid,text,integer,jsonb,text,text,uuid,uuid,uuid,text,timestamptz)', 'EXECUTE'), 'authenticated cannot call enqueue directly');
select ok(not has_function_privilege('service_role', 'private.enqueue_notification(uuid,text,uuid,text,integer,jsonb,text,text,uuid,uuid,uuid,text,timestamptz)', 'EXECUTE'), 'enqueue is composed internally, not exposed to service_role');

select ok(has_function_privilege('authenticated', 'public.cancel_notification(uuid,uuid)', 'EXECUTE'), 'authenticated (owner gate internal) may cancel');
select ok(has_function_privilege('authenticated', 'public.retry_notification(uuid,uuid)', 'EXECUTE'), 'authenticated (owner gate internal) may request a manual retry');
select ok(has_function_privilege('authenticated', 'public.disable_line_channel(uuid,uuid,text)', 'EXECUTE'), 'authenticated (owner gate internal) may disable a channel');
select ok(not has_function_privilege('anon', 'public.disable_line_channel(uuid,uuid,text)', 'EXECUTE'), 'anon cannot disable a channel');

------------------------------------------------------------------------------
-- 2. Secret is never SELECTable by authenticated.
------------------------------------------------------------------------------

select ok(
  (select relforcerowsecurity from pg_class where oid = 'private.line_channel_credentials'::regclass),
  'line_channel_credentials forces RLS'
);
select ok(
  not has_table_privilege('authenticated', 'private.line_channel_credentials', 'SELECT'),
  'authenticated has NO grant to read encrypted LINE credentials'
);
select ok(
  not has_table_privilege('anon', 'private.line_channel_credentials', 'SELECT'),
  'anon has NO grant to read encrypted LINE credentials'
);
-- line_channels carries no ciphertext columns; confirm the sensitive material
-- lives only in the private table (defense against future column drift).
select ok(
  not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'line_channels'
      and column_name ~* 'secret|token|ciphertext|nonce'
  ),
  'line_channels exposes no secret/token/ciphertext columns'
);

------------------------------------------------------------------------------
-- 3. Webhook ingestion: dedupe (both uniques), quick success, cross-tenant.
------------------------------------------------------------------------------

set local role service_role;

select is(
  public.ingest_line_webhook_event(
    'a1c00000-0000-4000-8000-000000000001', 'wh-evt-0001', 'message',
    '2026-07-20 01:00:00+00',
    '{"events":[{"type":"message","webhookEventId":"wh-evt-0001"}]}'::jsonb,
    repeat('a', 64)
  ) ->> 'duplicate', 'false', 'first ingest of a fresh webhook event is not a duplicate'
);
select is(
  public.ingest_line_webhook_event(
    'a1c00000-0000-4000-8000-000000000001', 'wh-evt-0001', 'message',
    '2026-07-20 01:00:00+00',
    '{"events":[{"type":"message","webhookEventId":"wh-evt-0001"}]}'::jsonb,
    repeat('a', 64)
  ) ->> 'duplicate', 'true', 'replaying the same webhook_event_id is reported as a duplicate (event_id unique)'
);

-- fallback dedupe: no webhook_event_id, dedupe on (channel, sha256, timestamp).
select is(
  public.ingest_line_webhook_event(
    'a1c00000-0000-4000-8000-000000000001', null, 'follow',
    '2026-07-20 02:00:00+00',
    '{"events":[{"type":"follow"}]}'::jsonb,
    repeat('b', 64)
  ) ->> 'duplicate', 'false', 'first ingest of a null-id event is not a duplicate'
);
select is(
  public.ingest_line_webhook_event(
    'a1c00000-0000-4000-8000-000000000001', null, 'follow',
    '2026-07-20 02:00:00+00',
    '{"events":[{"type":"follow"}]}'::jsonb,
    repeat('b', 64)
  ) ->> 'duplicate', 'true', 'replaying the same null-id payload is deduped by (channel, sha256, timestamp)'
);

reset role;
select is(
  (select count(*)::int from public.line_webhook_events
     where line_channel_id = 'a1c00000-0000-4000-8000-000000000001' and status = 'pending'),
  2, 'both dedupe uniques kept exactly one pending row per distinct ingested event'
);
select is(
  (select organization_id from public.line_webhook_events where webhook_event_id = 'wh-evt-0001'),
  '20000000-0000-4000-8000-000000000001'::uuid, 'ingest resolves organization_id from the channel'
);
select is(
  (select status from public.line_webhook_events where webhook_event_id = 'wh-evt-0001'),
  'pending', 'ingested events land pending for the worker to claim'
);
select ok(
  (select last_webhook_at from public.line_channels where id = 'a1c00000-0000-4000-8000-000000000001') is not null,
  'ingest touches line_channels.last_webhook_at'
);

-- unknown channel is rejected (no silent tenant leak).
set local role service_role;
select throws_ok(
  $$select public.ingest_line_webhook_event('00000000-0000-4000-8000-0000000000ff', 'wh-x', 'message', now(), '{}'::jsonb, repeat('c',64))$$,
  'P0002', 'LINE_CHANNEL_NOT_FOUND', 'ingest into an unknown channel is rejected'
);

------------------------------------------------------------------------------
-- 4. Webhook claim (SKIP LOCKED) + processed/ignored/failed transitions.
------------------------------------------------------------------------------

set local role service_role;
select is(
  jsonb_array_length(public.claim_line_webhook_events('worker-1', 10)),
  2, 'the worker claims both pending webhook events'
);
-- a second concurrent claim in the SAME session sees nothing new (rows are now processing).
select is(
  jsonb_array_length(public.claim_line_webhook_events('worker-2', 10)),
  0, 'a re-claim finds no pending webhook events (claim moved them to processing)'
);

reset role;
select is(
  (select count(*)::int from public.line_webhook_events where status = 'processing' and line_channel_id = 'a1c00000-0000-4000-8000-000000000001'),
  2, 'claimed webhook events are marked processing with a locked_at'
);

set local role service_role;
select is(
  public.mark_webhook_processed(
    (select id from public.line_webhook_events where webhook_event_id = 'wh-evt-0001'),
    'converted-to-service-request'
  ) ->> 'status', 'processed', 'processed transition is applied'
);
select is(
  public.mark_webhook_ignored(
    (select id from public.line_webhook_events where webhook_event_id is null and event_type = 'follow' limit 1),
    'no_domain_action'
  ) ->> 'status', 'ignored', 'ignored transition is applied'
);
-- mark_webhook on a non-processing row is rejected (from-state guard).
select throws_ok(
  format($$select public.mark_webhook_processed(%L, 'x')$$,
    (select id from public.line_webhook_events where webhook_event_id = 'wh-evt-0001')),
  'P0001', 'WEBHOOK_NOT_PROCESSING', 'marking an already-processed webhook again is rejected'
);

------------------------------------------------------------------------------
-- 5. Enqueue (internal) — dedupe collapses transition replay to one row.
------------------------------------------------------------------------------

-- enqueue is not granted to any PostgREST role; exercise it as owner (superuser).
reset role;
select is(
  private.test_enqueue_customer_notification(
    '20000000-0000-4000-8000-000000000001', 'a1c00000-0000-4000-8000-000000000001',
    'a1de0000-0000-4000-8000-000000000001', 'quote_sent', 1,
    '{"quoteNo":"Q-2026-0001"}'::jsonb, 'm6-enqueue-quote-0001',
    'quote', '85000000-0000-4000-8000-000000000001', 'not_required'
  ) ->> 'enqueued', 'true', 'first enqueue creates a pending outbox row'
);
select is(
  private.test_enqueue_customer_notification(
    '20000000-0000-4000-8000-000000000001', 'a1c00000-0000-4000-8000-000000000001',
    'a1de0000-0000-4000-8000-000000000001', 'quote_sent', 1,
    '{"quoteNo":"Q-2026-0001"}'::jsonb, 'm6-enqueue-quote-0001',
    'quote', '85000000-0000-4000-8000-000000000001', 'not_required'
  ) ->> 'enqueued', 'false', 'replaying the same dedupe_key does not create a second row'
);
select is(
  (select count(*)::int from public.notifications where dedupe_key = 'm6-enqueue-quote-0001'),
  1, 'ON CONFLICT DO NOTHING keeps exactly one outbox row per dedupe_key'
);
select is(
  (select status from public.notifications where dedupe_key = 'm6-enqueue-quote-0001'),
  'pending', 'enqueued notification starts pending'
);

------------------------------------------------------------------------------
-- 6. Claim: only approved/not_required; approval-pending stays queued.
------------------------------------------------------------------------------

-- Second enqueue that requires approval — should NOT be claimable yet.
reset role;
select is(
  private.test_enqueue_customer_notification(
    '20000000-0000-4000-8000-000000000001', 'a1c00000-0000-4000-8000-000000000001',
    'a1de0000-0000-4000-8000-000000000001', 'payment_reminder', 1,
    '{"amountMinor":150000}'::jsonb, 'm6-enqueue-pay-0001',
    'quote', '85000000-0000-4000-8000-000000000001', 'pending'
  ) ->> 'enqueued', 'true', 'an approval-pending notification is enqueued'
);

-- Park the seed failed row far in the future so this section isolates the two
-- freshly-enqueued Alpha rows; section 8 resets it to exercise retry/backoff.
reset role;
update public.notifications set next_attempt_at = '2035-01-01 00:00:00+00'
  where id = '88100000-0000-4000-8000-000000000001';

set local role service_role;
-- claim with now well in the future so scheduled_at is due.
select is(
  jsonb_array_length(public.claim_notifications('nworker-1', 50, '2030-01-01 12:00:00+00')),
  1, 'claim returns only the not_required notification, never the approval-pending one'
);
reset role;
select is(
  (select status from public.notifications where dedupe_key = 'm6-enqueue-quote-0001'),
  'processing', 'the claimed notification is now processing'
);
select is(
  (select status from public.notifications where dedupe_key = 'm6-enqueue-pay-0001'),
  'pending', 'the approval-pending notification is left pending (not claimed)'
);
select is(
  (select locked_by from public.notifications where dedupe_key = 'm6-enqueue-quote-0001'),
  'nworker-1', 'claim stamps locked_by with the worker id'
);

-- a re-claim finds nothing (only remaining pending row is approval-pending).
set local role service_role;
select is(
  jsonb_array_length(public.claim_notifications('nworker-2', 50, '2030-01-01 12:00:00+00')),
  0, 'no double-claim: the processing row is not handed to a second worker'
);

------------------------------------------------------------------------------
-- 7. mark_notification_sent — processing -> sent + append attempt.
------------------------------------------------------------------------------

set local role service_role;
select is(
  public.mark_notification_sent(
    (select id from public.notifications where dedupe_key = 'm6-enqueue-quote-0001'),
    'line-msg-id-abc'
  ) ->> 'status', 'sent', 'a processing notification is marked sent'
);
reset role;
select is(
  (select provider_message_id from public.notifications where dedupe_key = 'm6-enqueue-quote-0001'),
  'line-msg-id-abc', 'sent records the provider message id'
);
select is(
  (select count(*)::int from public.notification_attempts na
     join public.notifications n on n.id = na.notification_id
    where n.dedupe_key = 'm6-enqueue-quote-0001'),
  1, 'a sent attempt row is appended'
);
select is(
  (select outcome from public.notification_attempts na
     join public.notifications n on n.id = na.notification_id
    where n.dedupe_key = 'm6-enqueue-quote-0001' limit 1),
  'sent', 'the appended attempt outcome is sent'
);

-- from-state guard: cannot re-send a sent notification.
set local role service_role;
select throws_ok(
  format($$select public.mark_notification_sent(%L, 'x')$$,
    (select id from public.notifications where dedupe_key = 'm6-enqueue-quote-0001')),
  'P0001', 'NOTIFICATION_NOT_PROCESSING', 'a sent notification cannot be marked sent again'
);

------------------------------------------------------------------------------
-- 8. Retry backoff: increments next_attempt_at, appends attempts, fails at max.
--    Uses the seed failed notification 88100000..0001 (attempt_count 1, max 5).
------------------------------------------------------------------------------

-- Drive it through the worker: claim -> retry -> claim -> retry ... to max.
-- Deterministic p_now; full-jitter delay must fall in (p_now, p_now + base].

-- Un-park the seed failed row (section 6 pushed it to 2035) so it is due again.
reset role;
update public.notifications set next_attempt_at = '2026-01-05 00:05:00+00'
  where id = '88100000-0000-4000-8000-000000000001';

set local role service_role;
-- Claim the seed failed row (next_attempt_at 2026-01-05, so due at any 2026-07 now).
select is(
  jsonb_array_length(public.claim_notifications('rworker', 50, '2030-01-01 12:00:00+00')),
  1, 'the seed failed notification is claimable (failed + due)'
);

-- attempt 2 fails (retriable): attempt_count 1 -> 2, base delay 2min.
select is(
  public.mark_notification_retry(
    '88100000-0000-4000-8000-000000000001', 'RATE_LIMITED', '2030-01-01 12:00:00+00'
  ) ->> 'status', 'failed', 'a retriable failure below max returns to a failed (re-queueable) state'
);
reset role;
select is(
  (select attempt_count from public.notifications where id = '88100000-0000-4000-8000-000000000001'),
  2::smallint, 'retry increments attempt_count'
);
select ok(
  (select next_attempt_at from public.notifications where id = '88100000-0000-4000-8000-000000000001')
    > '2030-01-01 12:00:00+00'::timestamptz,
  'retry schedules next_attempt_at strictly in the future'
);
select ok(
  (select next_attempt_at from public.notifications where id = '88100000-0000-4000-8000-000000000001')
    <= '2030-01-01 12:02:00+00'::timestamptz,
  'attempt 2 full-jitter delay is within the 2 minute ceiling'
);
select is(
  (select count(*)::int from public.notification_attempts where notification_id = '88100000-0000-4000-8000-000000000001'),
  1, 'each retry appends one failed attempt row (attempt_no 2)'
);
select is(
  (select attempt_no from public.notification_attempts where notification_id = '88100000-0000-4000-8000-000000000001' order by attempt_no desc limit 1),
  2::smallint, 'the appended attempt_no matches the incremented attempt_count'
);

-- Drive attempts 3, 4, 5. At attempt_count 5 == max_attempts the row is terminal failed.
set local role service_role;
select public.claim_notifications('rworker', 50, '2030-01-02 00:00:00+00');
select public.mark_notification_retry('88100000-0000-4000-8000-000000000001', 'RATE_LIMITED', '2030-01-02 00:00:00+00'); -- ->3
select public.claim_notifications('rworker', 50, '2030-01-02 01:00:00+00');
select public.mark_notification_retry('88100000-0000-4000-8000-000000000001', 'RATE_LIMITED', '2030-01-02 01:00:00+00'); -- ->4
select public.claim_notifications('rworker', 50, '2030-01-02 02:00:00+00');
select is(
  public.mark_notification_retry('88100000-0000-4000-8000-000000000001', 'RATE_LIMITED', '2030-01-02 02:00:00+00') ->> 'status',
  'failed', 'the fifth attempt reports failed'
);
reset role;
select is(
  (select attempt_count from public.notifications where id = '88100000-0000-4000-8000-000000000001'),
  5::smallint, 'attempt_count reaches max_attempts'
);
select ok(
  (select next_attempt_at from public.notifications where id = '88100000-0000-4000-8000-000000000001') is null,
  'at max_attempts the row is terminal: no next_attempt_at is scheduled'
);
select ok(
  (select failed_at from public.notifications where id = '88100000-0000-4000-8000-000000000001') is not null,
  'at max_attempts failed_at is stamped'
);

-- A terminal (max-exhausted) notification is no longer claimable.
set local role service_role;
select is(
  jsonb_array_length(public.claim_notifications('rworker', 50, '2027-01-01 00:00:00+00')),
  0, 'a notification that exhausted max_attempts is never re-claimed'
);

------------------------------------------------------------------------------
-- 9. Permanent failure (4xx) fails immediately regardless of attempt_count.
------------------------------------------------------------------------------

reset role;
select private.test_enqueue_customer_notification(
  '20000000-0000-4000-8000-000000000001', 'a1c00000-0000-4000-8000-000000000001',
  'a1de0000-0000-4000-8000-000000000001', 'received', 1,
  '{}'::jsonb, 'm6-perm-fail-0001', null, null, 'not_required'
);
set local role service_role;
select public.claim_notifications('pworker', 50, '2030-01-01 12:00:00+00');
select is(
  public.mark_notification_failed(
    (select id from public.notifications where dedupe_key = 'm6-perm-fail-0001'),
    'INVALID_RECIPIENT'
  ) ->> 'status', 'failed', 'a permanent failure marks the row failed'
);
reset role;
select is(
  (select attempt_count from public.notifications where dedupe_key = 'm6-perm-fail-0001'),
  1::smallint, 'permanent failure still records the attempt'
);
select ok(
  (select next_attempt_at from public.notifications where dedupe_key = 'm6-perm-fail-0001') is null,
  'a permanently failed notification schedules no retry'
);

------------------------------------------------------------------------------
-- 10. Watchdog requeues stale processing rows (>5min).
------------------------------------------------------------------------------

reset role;
select private.test_enqueue_customer_notification(
  '20000000-0000-4000-8000-000000000001', 'a1c00000-0000-4000-8000-000000000001',
  'a1de0000-0000-4000-8000-000000000001', 'en_route', 1,
  '{}'::jsonb, 'm6-stale-0001', null, null, 'not_required'
);
set local role service_role;
select public.claim_notifications('deadworker', 50, '2030-01-01 12:00:00+00');
reset role;
select is(
  (select status from public.notifications where dedupe_key = 'm6-stale-0001'),
  'processing', 'the stale notification is stuck processing'
);
-- Force locked_at into the past so the watchdog sees it as stale.
update public.notifications set locked_at = '2026-07-20 11:50:00+00'
  where dedupe_key = 'm6-stale-0001';

set local role service_role;
select is(
  public.requeue_stale_notifications('2030-01-01 12:00:00+00', 5) ->> 'requeued', '1',
  'the watchdog requeues one stale processing notification (>5min)'
);
reset role;
select is(
  (select status from public.notifications where dedupe_key = 'm6-stale-0001'),
  'pending', 'a requeued notification returns to pending'
);
select ok(
  (select locked_by from public.notifications where dedupe_key = 'm6-stale-0001') is null,
  'a requeued notification clears its lock'
);

------------------------------------------------------------------------------
-- 11. Cancel (pending/failed) — staff-facing, from-state guard.
--   authenticated has NO direct table grants (revoked in phase-1 hardening), so
--   ids are resolved under superuser and threaded through set_config for the RPC.
------------------------------------------------------------------------------

reset role;
select set_config('test.m6_stale_id',
  (select id::text from public.notifications where dedupe_key = 'm6-stale-0001'), true);
select set_config('test.m6_pay_id',
  (select id::text from public.notifications where dedupe_key = 'm6-enqueue-pay-0001'), true);

-- Cancel the still-pending stale row.
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
select is(
  public.cancel_notification(
    '20000000-0000-4000-8000-000000000001',
    current_setting('test.m6_stale_id')::uuid
  ) ->> 'status', 'cancelled', 'a dispatcher cancels a pending notification'
);

-- technician cannot cancel.
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);
select throws_ok(
  format($$select public.cancel_notification('20000000-0000-4000-8000-000000000001', %L)$$,
    current_setting('test.m6_pay_id')),
  '42501', 'FORBIDDEN', 'a technician cannot cancel a notification'
);

-- cross-tenant: Beta owner cannot cancel Alpha's notification.
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000005', true);
select throws_ok(
  format($$select public.cancel_notification('20000000-0000-4000-8000-000000000002', %L)$$,
    current_setting('test.m6_pay_id')),
  'P0002', 'NOTIFICATION_NOT_FOUND', 'a cross-tenant owner cannot see or cancel another org notification'
);

------------------------------------------------------------------------------
-- 12. Manual retry (failed only) — staff-facing.
------------------------------------------------------------------------------

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
select is(
  public.retry_notification(
    '20000000-0000-4000-8000-000000000001', '88100000-0000-4000-8000-000000000001'
  ) ->> 'status', 'pending', 'a manual retry re-queues a failed notification to pending'
);
reset role;
select ok(
  (select next_attempt_at from public.notifications where id = '88100000-0000-4000-8000-000000000001')
    is not null,
  'manual retry schedules an immediate next_attempt_at'
);

-- manual retry on a non-failed (cancelled) notification is rejected. The stale
-- row was cancelled in section 11.
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
select throws_ok(
  format($$select public.retry_notification('20000000-0000-4000-8000-000000000001', %L)$$,
    current_setting('test.m6_stale_id')),
  'P0001', 'NOTIFICATION_NOT_RETRYABLE', 'a cancelled notification cannot be manually retried'
);

------------------------------------------------------------------------------
-- 16. Reopen -> recomplete enqueues a SECOND completed notification.
--   REGRESSION: before 202607200006 the dedupe_key was 'wo:ID:completed' with no
--   version discriminator, so the permanent notifications_dedupe_uidx collapsed
--   the recompletion onto the first row and the customer was NEVER re-notified.
--   The versioned key 'wo:ID:completed:v{new_lock_version}' fixes that: a reopen
--   bumps lock_version so the recomplete gets a distinct key + a fresh outbox row.
--
--   Uses seed WO 82000000..0001 (scheduled, lock 1, customer 40..0001 bound to the
--   active Alpha channel). Owner (10..0001) marches it to on_site, force-completes
--   (v5), reopens (completed->on_site), force-completes again (v7).
------------------------------------------------------------------------------

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);

-- scheduled(1) -> dispatched(2) -> en_route(3) -> on_site(4)
select public.transition_work_order_safe('20000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000001', 'dispatched', 1, statement_timestamp());
select public.transition_work_order_safe('20000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000001', 'en_route', 2, statement_timestamp());
select is(
  public.transition_work_order_safe('20000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000001', 'on_site', 3, statement_timestamp()) ->> 'status',
  'on_site', 'owner marches the seed work order to on_site'
);

-- force-complete #1: on_site(4) -> completed(5). Enqueues wo:...:completed:v5.
select is(
  public.force_complete_work_order('20000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000001', '客戶不在現場，改由店家代簽收', '首次完工', 4, statement_timestamp(), null, null) ->> 'status',
  'completed', 'owner force-completes the work order the first time'
);
reset role;
select is(
  (select count(*)::int from public.notifications
     where related_type = 'work_order' and related_id = '82000000-0000-4000-8000-000000000001'
       and dedupe_key = 'wo:82000000-0000-4000-8000-000000000001:completed:v5'),
  1, 'the first completion enqueues a versioned completed notification (v5)'
);

-- reopen: completed(5) -> on_site(6). Owner + reason, within 24h. No notification.
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select is(
  public.transition_work_order_safe('20000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000001', 'on_site', 5, statement_timestamp(), '客戶回報仍有異音需複工') ->> 'status',
  'on_site', 'owner reopens the completed work order back to on_site'
);

-- force-complete #2: on_site(6) -> completed(7). Enqueues wo:...:completed:v7.
select is(
  public.force_complete_work_order('20000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000001', '複工後再次完工', '二次完工', 6, statement_timestamp(), null, null) ->> 'status',
  'completed', 'owner force-completes the work order again after the reopen'
);
reset role;
select is(
  (select count(*)::int from public.notifications
     where related_type = 'work_order' and related_id = '82000000-0000-4000-8000-000000000001'
       and dedupe_key = 'wo:82000000-0000-4000-8000-000000000001:completed:v7'),
  1, 'the recompletion enqueues a SECOND versioned completed notification (v7)'
);
select is(
  (select count(*)::int from public.notifications
     where related_type = 'work_order' and related_id = '82000000-0000-4000-8000-000000000001'
       and template_key = 'completed'),
  2, 'reopen->recomplete yields TWO completed outbox rows (regression: was silently 1)'
);

------------------------------------------------------------------------------
-- 17. Reschedule enqueues a SECOND appointment_confirmed notification.
--   Same class of bug: 'wo:ID:appointment_confirmed' had no version, so a
--   draft->reschedule collided with the first appointment_confirmed and dropped
--   the re-notification. The versioned key fixes it.
--
--   Uses seed draft WO 82060000..0001 (lock 1, customer 40..0001 bound). Scheduled
--   away from the seed 2026-08-10 window so no assignment conflict fires.
------------------------------------------------------------------------------

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);

-- schedule #1: window update 1->2 (v_count=2), transition draft->scheduled 2->3.
select is(
  public.schedule_work_order(
    '20000000-0000-4000-8000-000000000001', '82060000-0000-4000-8000-000000000001',
    '2026-09-01 01:00:00+00', '2026-09-01 03:00:00+00',
    '[{"membershipId":"30000000-0000-4000-8000-000000000003","duty":"lead"}]'::jsonb,
    1, statement_timestamp()
  ) ->> 'status', 'scheduled', 'owner schedules the draft work order the first time'
);
reset role;
select is(
  (select count(*)::int from public.notifications
     where related_type = 'work_order' and related_id = '82060000-0000-4000-8000-000000000001'
       and dedupe_key = 'wo:82060000-0000-4000-8000-000000000001:appointment_confirmed:v2'),
  1, 'the first schedule enqueues a versioned appointment_confirmed notification (v2)'
);

-- reschedule: scheduled(3) -> draft(4) (manager + reason), then schedule again.
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select is(
  public.transition_work_order_safe('20000000-0000-4000-8000-000000000001', '82060000-0000-4000-8000-000000000001', 'draft', 3, statement_timestamp(), '客戶要求改期') ->> 'status',
  'draft', 'owner returns the scheduled work order to draft to reschedule'
);

-- schedule #2: window update 4->5 (v_count=5), transition draft->scheduled 5->6.
select is(
  public.schedule_work_order(
    '20000000-0000-4000-8000-000000000001', '82060000-0000-4000-8000-000000000001',
    '2026-09-05 01:00:00+00', '2026-09-05 03:00:00+00',
    '[{"membershipId":"30000000-0000-4000-8000-000000000003","duty":"lead"}]'::jsonb,
    4, statement_timestamp()
  ) ->> 'status', 'scheduled', 'owner reschedules the work order to a new window'
);
reset role;
select is(
  (select count(*)::int from public.notifications
     where related_type = 'work_order' and related_id = '82060000-0000-4000-8000-000000000001'
       and dedupe_key = 'wo:82060000-0000-4000-8000-000000000001:appointment_confirmed:v5'),
  1, 'the reschedule enqueues a SECOND versioned appointment_confirmed notification (v5)'
);
select is(
  (select count(*)::int from public.notifications
     where related_type = 'work_order' and related_id = '82060000-0000-4000-8000-000000000001'
       and template_key = 'appointment_confirmed'),
  2, 'schedule->reschedule yields TWO appointment_confirmed outbox rows (regression: was silently 1)'
);

------------------------------------------------------------------------------
-- 18. A genuine same-lock_version replay still collapses to ONE row.
--   The fix must NOT break idempotency: an identical versioned key (same
--   transaction replay, same lock_version) still hits ON CONFLICT DO NOTHING.
------------------------------------------------------------------------------

reset role;
select is(
  private.test_enqueue_customer_notification(
    '20000000-0000-4000-8000-000000000001', 'a1c00000-0000-4000-8000-000000000001',
    'a1de0000-0000-4000-8000-000000000001', 'completed', 1,
    '{"workOrderNumber":"W-2026-0001"}'::jsonb,
    'wo:82000000-0000-4000-8000-000000000001:completed:v5',
    'work_order', '82000000-0000-4000-8000-000000000001', 'not_required'
  ) ->> 'enqueued', 'false', 'a same-lock_version (identical key) replay does not create a second row'
);
select is(
  (select count(*)::int from public.notifications
     where dedupe_key = 'wo:82000000-0000-4000-8000-000000000001:completed:v5'),
  1, 'the versioned key still collapses an idempotent replay to exactly one row'
);

------------------------------------------------------------------------------
-- 13. Kill switch: disable_line_channel (owner) + audit event + claim exclusion.
------------------------------------------------------------------------------

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select is(
  public.disable_line_channel(
    '20000000-0000-4000-8000-000000000001', 'a1c00000-0000-4000-8000-000000000001', 'incident_response'
  ) ->> 'status', 'disabled', 'an owner disables the LINE channel'
);
reset role;
select is(
  (select status from public.line_channels where id = 'a1c00000-0000-4000-8000-000000000001'),
  'disabled', 'the channel status is disabled'
);
select is(
  (select event_type from public.events
     where aggregate_type = 'line_channel' and aggregate_id = 'a1c00000-0000-4000-8000-000000000001'
     order by chain_sequence desc limit 1),
  'line_channel.disabled', 'disabling appends a line_channel audit event'
);

-- dispatcher cannot disable a channel (owner/admin only).
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
select throws_ok(
  $$select public.disable_line_channel('20000000-0000-4000-8000-000000000001', 'a1c00000-0000-4000-8000-000000000001', 'nope')$$,
  '42501', 'FORBIDDEN', 'a dispatcher cannot disable a LINE channel'
);

------------------------------------------------------------------------------
-- 14. Tenant isolation on inbox/outbox. In this schema authenticated has NO
-- direct table grants at all (phase-1 hardening revoked them): every staff read
-- goes through a security-definer RPC that filters by org internally. So the
-- outbox tenant boundary is proven by (a) the cross-tenant RPC guard in §11
-- (Beta owner -> NOTIFICATION_NOT_FOUND) and (b) the RLS policy existing as
-- defense-in-depth. The inbox additionally has no authenticated SELECT policy
-- at all, so even if a grant existed it would return zero rows for any org.
------------------------------------------------------------------------------

reset role;
select ok(
  not has_table_privilege('authenticated', 'public.notifications', 'SELECT'),
  'authenticated has no direct SELECT on notifications (reads go through RPCs)'
);
select ok(
  exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'notifications'
      and policyname = 'notifications_select_manager'
  ),
  'the org-scoped RLS select policy on notifications exists as defense-in-depth'
);
select ok(
  not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'line_webhook_events' and cmd = 'SELECT'
  ),
  'line_webhook_events has NO authenticated select policy (worker-only inbox)'
);
select ok(
  not has_table_privilege('authenticated', 'public.line_webhook_events', 'SELECT'),
  'authenticated has no direct SELECT on the raw webhook inbox'
);

------------------------------------------------------------------------------
-- 15. Inbox / attempts immutability and no-authenticated-mutation.
------------------------------------------------------------------------------

select ok(not has_table_privilege('authenticated', 'public.line_webhook_events', 'INSERT'), 'authenticated cannot insert webhook events');
select ok(not has_table_privilege('authenticated', 'public.line_webhook_events', 'UPDATE'), 'authenticated cannot update webhook events');
select ok(not has_table_privilege('authenticated', 'public.line_webhook_events', 'DELETE'), 'authenticated cannot delete webhook events');
select ok(not has_table_privilege('authenticated', 'public.notification_attempts', 'INSERT'), 'authenticated cannot insert notification attempts');
select ok(not has_table_privilege('authenticated', 'public.notification_attempts', 'UPDATE'), 'authenticated cannot update notification attempts');
select ok(not has_table_privilege('authenticated', 'public.notification_attempts', 'DELETE'), 'authenticated cannot delete notification attempts');

-- attempts are append-only even for the owner role (immutability trigger).
reset role;
select throws_ok(
  $$update public.notification_attempts set outcome = 'sent' where notification_id = '88100000-0000-4000-8000-000000000001'$$,
  'P0001', 'APPEND_ONLY_RECORD', 'notification_attempts rows cannot be updated'
);
select throws_ok(
  $$delete from public.notification_attempts where notification_id = '88100000-0000-4000-8000-000000000001'$$,
  'P0001', 'APPEND_ONLY_RECORD', 'notification_attempts rows cannot be deleted'
);

------------------------------------------------------------------------------
-- 19. Webhook inbox terminal state at the max-attempts ceiling.
--   REGRESSION: before 202607200006 a permanently-failing webhook event had no
--   terminal state — mark_webhook_failed always re-scheduled next_attempt_at, so
--   the worker re-claimed and re-failed it forever, bumping attempt_count until
--   the (0..100) CHECK finally threw. Now a failed event becomes terminal once
--   attempt_count reaches max_attempts: next_attempt_at null, failed_at stamped,
--   never re-claimed. We shrink max_attempts to 2 so the ceiling is reached fast.
------------------------------------------------------------------------------

set local role service_role;
select public.ingest_line_webhook_event(
  'a1c00000-0000-4000-8000-000000000001', 'wh-terminal-0001', 'message',
  '2026-07-20 03:00:00+00',
  '{"events":[{"type":"message","webhookEventId":"wh-terminal-0001"}]}'::jsonb,
  repeat('d', 64)
);
reset role;
update public.line_webhook_events set max_attempts = 2 where webhook_event_id = 'wh-terminal-0001';

set local role service_role;
-- attempt 1: claim -> fail. Below ceiling (1 < 2): stays failed, re-queueable.
select public.claim_line_webhook_events('wt-worker', 50, '2030-01-01 12:00:00+00');
select public.mark_webhook_failed(
  (select id from public.line_webhook_events where webhook_event_id = 'wh-terminal-0001'),
  'PROVIDER_5XX'
);
reset role;
select ok(
  (select next_attempt_at from public.line_webhook_events where webhook_event_id = 'wh-terminal-0001') is not null,
  'a webhook failure below the ceiling schedules a retry (next_attempt_at set)'
);
select ok(
  (select failed_at from public.line_webhook_events where webhook_event_id = 'wh-terminal-0001') is null,
  'a webhook failure below the ceiling is NOT terminal (failed_at still null)'
);

-- attempt 2: claim (due) -> fail. At ceiling (2 >= 2): terminal.
set local role service_role;
select public.claim_line_webhook_events('wt-worker', 50, '2030-01-01 13:00:00+00');
select is(
  public.mark_webhook_failed(
    (select id from public.line_webhook_events where webhook_event_id = 'wh-terminal-0001'),
    'PROVIDER_5XX'
  ) ->> 'terminal', 'true', 'the failure that reaches max_attempts reports terminal'
);
reset role;
select ok(
  (select next_attempt_at from public.line_webhook_events where webhook_event_id = 'wh-terminal-0001') is null,
  'a webhook event that reaches max_attempts schedules no further retry'
);
select ok(
  (select failed_at from public.line_webhook_events where webhook_event_id = 'wh-terminal-0001') is not null,
  'a webhook event that reaches max_attempts stamps failed_at (terminal)'
);

-- The exhausted event is never re-claimed even when its (null) due time passes.
set local role service_role;
select is(
  (select coalesce(sum((e ->> 'webhookEventId' = 'wh-terminal-0001')::int), 0)::int
     from jsonb_array_elements(public.claim_line_webhook_events('wt-worker', 50, '2030-01-02 00:00:00+00')) e),
  0, 'a webhook event that exhausted max_attempts is never re-claimed'
);

------------------------------------------------------------------------------
-- 20. requeue_stale_line_webhook_events requeues a stuck processing row.
--   Mirrors requeue_stale_notifications: a processing row whose locked_at is
--   older than the threshold returns to pending with its lock cleared.
------------------------------------------------------------------------------

set local role service_role;
select public.ingest_line_webhook_event(
  'a1c00000-0000-4000-8000-000000000001', 'wh-stale-0001', 'message',
  '2026-07-20 04:00:00+00',
  '{"events":[{"type":"message","webhookEventId":"wh-stale-0001"}]}'::jsonb,
  repeat('e', 64)
);
select public.claim_line_webhook_events('ws-worker', 50, '2030-01-01 12:00:00+00');
reset role;
select is(
  (select status from public.line_webhook_events where webhook_event_id = 'wh-stale-0001'),
  'processing', 'the claimed webhook event is stuck processing'
);
-- Force locked_at into the past so the watchdog sees it as stale (>5min).
update public.line_webhook_events set locked_at = '2026-07-20 11:50:00+00'
  where webhook_event_id = 'wh-stale-0001';

set local role service_role;
select is(
  public.requeue_stale_line_webhook_events('2030-01-01 12:00:00+00', 5) ->> 'requeued', '1',
  'the inbox watchdog requeues one stale processing webhook event (>5min)'
);
reset role;
select is(
  (select status from public.line_webhook_events where webhook_event_id = 'wh-stale-0001'),
  'pending', 'a requeued webhook event returns to pending'
);
select ok(
  (select locked_at from public.line_webhook_events where webhook_event_id = 'wh-stale-0001') is null,
  'a requeued webhook event clears its lock'
);

select * from finish();
rollback;
