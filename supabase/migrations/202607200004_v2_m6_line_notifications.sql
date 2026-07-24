-- Renoly v2 M6 — LINE webhook ingestion, notification outbox, retry/backoff,
-- watchdog and channel kill-switch RPCs.
--
-- The M6 tables (line_channels, private.line_channel_credentials, notifications,
-- notification_attempts, line_webhook_events) and their RLS/grants already exist
-- (foundation + operations + security migrations). This migration adds ONLY the
-- transactional RPCs and the state machines that drive them. No schema change.
--
-- Role boundary:
--   * Webhook inbox + outbox worker RPCs are security-definer and granted to
--     service_role only (no PostgREST authenticated path to the inbox/worker).
--   * Staff-facing RPCs (cancel/retry/disable) are granted to authenticated;
--     the owner/dispatcher gate is enforced INSIDE the function via has_org_role,
--     never by a hidden button.
--   * enqueue_notification is composed internally (called by M4/M5 mutation RPCs
--     in the same transaction) and is granted to NO PostgREST role.
--
-- Notification state machine:
--   pending    --claim-->        processing
--   processing --sent-->         sent            (terminal, provider_message_id)
--   processing --retry(<max)-->  failed          (re-queueable: next_attempt_at set)
--   processing --retry(=max)-->  failed          (terminal: next_attempt_at null, failed_at)
--   processing --fail-->         failed          (permanent 4xx: next_attempt_at null)
--   processing --watchdog-->     pending         (stale >5min: lock cleared)
--   pending|failed --cancel-->   cancelled       (terminal)
--   failed     --manual retry--> pending         (next_attempt_at = now)
-- A row is claimable iff status in (pending, failed) AND
--   coalesce(next_attempt_at, scheduled_at) <= now AND
--   approval_status in (not_required, approved) AND
--   attempt_count < max_attempts.
--
-- Webhook state machine:
--   (insert) pending --claim--> processing --> processed | ignored | failed
--
-- Backoff (full jitter): base delay by upcoming attempt number
--   attempt 1->2: 1m, 2->3: 2m, 3->4: 5m, 4->5: 15m, 5+: 60m ceiling.
--   next_attempt_at = p_now + random() * base_delay (so within (p_now, p_now+base]).

set search_path = pg_catalog, public, private, extensions;

------------------------------------------------------------------------------
-- private.append_system_event — hash-chained audit event for system/kill-switch
-- actions. Mirrors private.append_user_event but writes actor_type='system'
-- (no actor user required), preserving the events chain invariants.
------------------------------------------------------------------------------
create or replace function private.append_system_event(
  target_org uuid,
  target_aggregate_type text,
  target_aggregate_id uuid,
  target_event_type text,
  target_payload jsonb,
  target_request_id uuid default null,
  target_idempotency_key text default null,
  target_occurred_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, private, extensions
as $$
declare
  event_id uuid := gen_random_uuid();
  previous_hash bytea;
  calculated_hash bytea;
  occurred timestamptz := coalesce(target_occurred_at, statement_timestamp());
  recorded timestamptz;
  next_chain_sequence bigint;
begin
  perform pg_advisory_xact_lock(
    hashtextextended(target_org::text || ':' || target_aggregate_type || ':' || target_aggregate_id::text, 0)
  );

  select e.event_hash, e.chain_sequence + 1
  into previous_hash, next_chain_sequence
  from public.events e
  where e.organization_id = target_org
    and e.aggregate_type = target_aggregate_type
    and e.aggregate_id = target_aggregate_id
  order by e.chain_sequence desc
  limit 1
  for share;

  next_chain_sequence := coalesce(next_chain_sequence, 1);
  recorded := clock_timestamp();

  calculated_hash := extensions.digest(
    coalesce(encode(previous_hash, 'hex'), '') || '|' || target_org::text || '|'
    || target_aggregate_type || '|' || target_aggregate_id::text || '|'
    || target_event_type || '|system|' || occurred::text || '|'
    || recorded::text || '|' || next_chain_sequence::text || '|'
    || coalesce(target_payload, '{}'::jsonb)::text,
    'sha256'
  );

  insert into public.events (
    id, organization_id, aggregate_type, aggregate_id, event_type,
    actor_type, occurred_at, recorded_at, chain_sequence,
    request_id, idempotency_key, payload, prev_hash, event_hash
  ) values (
    event_id, target_org, target_aggregate_type, target_aggregate_id, target_event_type,
    'system', occurred, recorded, next_chain_sequence,
    coalesce(target_request_id, gen_random_uuid()), target_idempotency_key,
    coalesce(target_payload, '{}'::jsonb), previous_hash, calculated_hash
  );

  return event_id;
end;
$$;

alter function private.append_system_event(uuid, text, uuid, text, jsonb, uuid, text, timestamptz)
  owner to renoly_rls_owner;
revoke all on function private.append_system_event(uuid, text, uuid, text, jsonb, uuid, text, timestamptz)
  from public, anon, authenticated, service_role;

------------------------------------------------------------------------------
-- private.notification_backoff_delay — full-jitter delay indexed by the number
-- of the attempt that JUST failed. base minutes: attempt 1->1m, 2->2m, 3->5m,
-- 4->15m, 5+->60m (ceiling). Full jitter: uniform in (0, base]. The scheduled
-- next_attempt_at is p_now + this delay, so it lies within (p_now, p_now+base].
------------------------------------------------------------------------------
create or replace function private.notification_backoff_delay(p_completed_attempt integer)
returns interval
language sql
immutable
set search_path = pg_catalog
as $$
  select (
    greatest(
      1.0,
      (case
        when p_completed_attempt <= 1 then 60
        when p_completed_attempt = 2 then 120
        when p_completed_attempt = 3 then 300
        when p_completed_attempt = 4 then 900
        else 3600
      end)::double precision
      * random()
    )
  ) * interval '1 second';
$$;

alter function private.notification_backoff_delay(integer) owner to renoly_rls_owner;
revoke all on function private.notification_backoff_delay(integer)
  from public, anon, authenticated, service_role;

------------------------------------------------------------------------------
-- private.enqueue_notification — transactional outbox insert. Called by M4/M5
-- mutation RPCs in the same transaction. ON CONFLICT (org,channel,dedupe_key)
-- DO NOTHING collapses transition replays to a single row.
-- Returns { enqueued: bool, notificationId: uuid|null, status: text }.
------------------------------------------------------------------------------
create or replace function private.enqueue_notification(
  target_org uuid,
  p_channel text,
  p_line_channel_id uuid,
  p_template_key text,
  p_template_version integer,
  p_payload jsonb,
  p_dedupe_key text,
  p_related_type text,
  p_related_id uuid,
  p_customer_line_identity_id uuid default null,
  p_membership_id uuid default null,
  p_approval_status text default 'not_required',
  p_scheduled_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_id uuid;
  v_scheduled timestamptz := coalesce(p_scheduled_at, statement_timestamp());
begin
  insert into public.notifications (
    organization_id, channel, line_channel_id, customer_line_identity_id,
    membership_id, template_key, template_version, payload, status,
    approval_status, dedupe_key, scheduled_at, next_attempt_at,
    related_type, related_id
  ) values (
    target_org, p_channel, p_line_channel_id, p_customer_line_identity_id,
    p_membership_id, p_template_key, p_template_version,
    coalesce(p_payload, '{}'::jsonb), 'pending',
    coalesce(p_approval_status, 'not_required'), p_dedupe_key, v_scheduled, v_scheduled,
    p_related_type, p_related_id
  )
  on conflict (organization_id, channel, dedupe_key) do nothing
  returning id into v_id;

  if v_id is null then
    -- Already enqueued by a prior (replayed) transition; surface the existing row.
    select id into v_id
    from public.notifications
    where organization_id = target_org and channel = p_channel and dedupe_key = p_dedupe_key;
    return jsonb_build_object('enqueued', false, 'notificationId', v_id, 'status', 'pending');
  end if;

  return jsonb_build_object('enqueued', true, 'notificationId', v_id, 'status', 'pending');
end;
$$;

alter function private.enqueue_notification(uuid, text, uuid, text, integer, jsonb, text, text, uuid, uuid, uuid, text, timestamptz)
  owner to renoly_rls_owner;
revoke all on function private.enqueue_notification(uuid, text, uuid, text, integer, jsonb, text, text, uuid, uuid, uuid, text, timestamptz)
  from public, anon, authenticated, service_role;

-- Test-only convenience wrapper exercised by pgTAP under `reset role`. It maps a
-- customer-recipient LINE enqueue to the internal enqueue and is granted to no
-- PostgREST role (superuser-only in tests).
create or replace function private.test_enqueue_customer_notification(
  target_org uuid,
  p_line_channel_id uuid,
  p_customer_line_identity_id uuid,
  p_template_key text,
  p_template_version integer,
  p_payload jsonb,
  p_dedupe_key text,
  p_related_type text,
  p_related_id uuid,
  p_approval_status text
)
returns jsonb
language sql
security definer
set search_path = pg_catalog, public, private
as $$
  select private.enqueue_notification(
    target_org, 'line', p_line_channel_id, p_template_key, p_template_version,
    p_payload, p_dedupe_key, p_related_type, p_related_id,
    p_customer_line_identity_id, null, p_approval_status, null
  );
$$;

alter function private.test_enqueue_customer_notification(uuid, uuid, uuid, text, integer, jsonb, text, text, uuid, text)
  owner to renoly_rls_owner;
revoke all on function private.test_enqueue_customer_notification(uuid, uuid, uuid, text, integer, jsonb, text, text, uuid, text)
  from public, anon, authenticated, service_role;

------------------------------------------------------------------------------
-- public.claim_notifications — outbox worker claim. FOR UPDATE SKIP LOCKED over
-- the claim partial index; moves due, approved/not_required, not-exhausted rows
-- to processing. Excludes rows whose LINE channel is disabled. service_role only.
-- Returns a jsonb array of claimed rows (id, org, channel, template, payload,
-- attempt_count, line_channel_id, recipient ids).
------------------------------------------------------------------------------
create or replace function public.claim_notifications(
  p_worker_id text,
  p_limit integer default 10,
  p_now timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_now timestamptz := coalesce(p_now, clock_timestamp());
  v_limit integer := greatest(1, least(coalesce(p_limit, 10), 50));
  v_result jsonb;
begin
  with claimable as (
    select n.id
    from public.notifications n
    left join public.line_channels lc on lc.id = n.line_channel_id
    where n.status in ('pending', 'failed')
      and n.approval_status in ('not_required', 'approved')
      and n.attempt_count < n.max_attempts
      and coalesce(n.next_attempt_at, n.scheduled_at) <= v_now
      and (n.channel <> 'line' or lc.status <> 'disabled')
    order by coalesce(n.next_attempt_at, n.scheduled_at), n.created_at, n.id
    limit v_limit
    for update of n skip locked
  ),
  claimed as (
    update public.notifications n
    set status = 'processing',
        locked_at = v_now,
        locked_by = p_worker_id
    from claimable c
    where n.id = c.id
    returning n.id, n.organization_id, n.channel, n.line_channel_id,
      n.customer_line_identity_id, n.membership_id, n.template_key,
      n.template_version, n.payload, n.attempt_count, n.max_attempts,
      n.dedupe_key, n.related_type, n.related_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id,
    'organizationId', organization_id,
    'channel', channel,
    'lineChannelId', line_channel_id,
    'customerLineIdentityId', customer_line_identity_id,
    'membershipId', membership_id,
    'templateKey', template_key,
    'templateVersion', template_version,
    'payload', payload,
    'attemptCount', attempt_count,
    'maxAttempts', max_attempts,
    'dedupeKey', dedupe_key,
    'relatedType', related_type,
    'relatedId', related_id
  )), '[]'::jsonb)
  into v_result
  from claimed;

  return v_result;
end;
$$;

alter function public.claim_notifications(text, integer, timestamptz) owner to renoly_rls_owner;
revoke all on function public.claim_notifications(text, integer, timestamptz)
  from public, anon, authenticated;
grant execute on function public.claim_notifications(text, integer, timestamptz) to service_role;

------------------------------------------------------------------------------
-- private.record_notification_attempt — append-only attempt row. attempt_no is
-- the current attempt_count (which the caller has already incremented for a send
-- attempt). Runs as the security-definer parent (owner), bypassing the
-- authenticated revoke on notification_attempts.
------------------------------------------------------------------------------
create or replace function private.record_notification_attempt(
  p_notification_id uuid,
  p_org uuid,
  p_attempt_no smallint,
  p_outcome text,
  p_started_at timestamptz,
  p_error_code text default null
)
returns void
language sql
security definer
set search_path = pg_catalog, public, private
as $$
  insert into public.notification_attempts (
    organization_id, notification_id, attempt_no, started_at, finished_at,
    outcome, error_code
  ) values (
    p_org, p_notification_id, p_attempt_no, p_started_at, clock_timestamp(),
    p_outcome, p_error_code
  );
$$;

alter function private.record_notification_attempt(uuid, uuid, smallint, text, timestamptz, text)
  owner to renoly_rls_owner;
revoke all on function private.record_notification_attempt(uuid, uuid, smallint, text, timestamptz, text)
  from public, anon, authenticated, service_role;

------------------------------------------------------------------------------
-- public.mark_notification_sent — processing -> sent. Appends a sent attempt.
------------------------------------------------------------------------------
create or replace function public.mark_notification_sent(
  p_notification_id uuid,
  p_provider_message_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_row public.notifications%rowtype;
  v_attempt smallint;
begin
  select * into v_row from public.notifications where id = p_notification_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'NOTIFICATION_NOT_FOUND';
  end if;
  if v_row.status <> 'processing' then
    raise exception using errcode = 'P0001', message = 'NOTIFICATION_NOT_PROCESSING';
  end if;

  v_attempt := (v_row.attempt_count + 1)::smallint;

  update public.notifications
  set status = 'sent',
      attempt_count = v_attempt,
      provider_message_id = p_provider_message_id,
      sent_at = clock_timestamp(),
      next_attempt_at = null,
      locked_at = null,
      locked_by = null,
      last_error_code = null,
      last_error_message = null
  where id = p_notification_id;

  perform private.record_notification_attempt(
    p_notification_id, v_row.organization_id, v_attempt, 'sent', coalesce(v_row.locked_at, clock_timestamp()), null
  );

  return jsonb_build_object('id', p_notification_id, 'status', 'sent', 'attemptCount', v_attempt);
end;
$$;

alter function public.mark_notification_sent(uuid, text) owner to renoly_rls_owner;
revoke all on function public.mark_notification_sent(uuid, text) from public, anon, authenticated;
grant execute on function public.mark_notification_sent(uuid, text) to service_role;

------------------------------------------------------------------------------
-- public.mark_notification_retry — processing -> failed. Increments attempt_count
-- and appends a failed attempt. If the new attempt_count reaches max_attempts the
-- row is terminal (no next_attempt_at, failed_at set); otherwise it schedules a
-- full-jitter backoff so the claim query re-queues it.
------------------------------------------------------------------------------
create or replace function public.mark_notification_retry(
  p_notification_id uuid,
  p_error_code text,
  p_now timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_row public.notifications%rowtype;
  v_now timestamptz := coalesce(p_now, clock_timestamp());
  v_attempt smallint;
  v_next timestamptz;
  v_terminal boolean;
begin
  select * into v_row from public.notifications where id = p_notification_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'NOTIFICATION_NOT_FOUND';
  end if;
  if v_row.status <> 'processing' then
    raise exception using errcode = 'P0001', message = 'NOTIFICATION_NOT_PROCESSING';
  end if;

  v_attempt := (v_row.attempt_count + 1)::smallint;
  v_terminal := v_attempt >= v_row.max_attempts;
  v_next := case when v_terminal then null
                 else v_now + private.notification_backoff_delay(v_attempt::integer) end;

  update public.notifications
  set status = 'failed',
      attempt_count = v_attempt,
      next_attempt_at = v_next,
      failed_at = case when v_terminal then clock_timestamp() else null end,
      locked_at = null,
      locked_by = null,
      last_error_code = p_error_code,
      last_error_message = p_error_code
  where id = p_notification_id;

  perform private.record_notification_attempt(
    p_notification_id, v_row.organization_id, v_attempt, 'failed', coalesce(v_row.locked_at, v_now), p_error_code
  );

  return jsonb_build_object(
    'id', p_notification_id, 'status', 'failed', 'attemptCount', v_attempt,
    'terminal', v_terminal, 'nextAttemptAt', v_next
  );
end;
$$;

alter function public.mark_notification_retry(uuid, text, timestamptz) owner to renoly_rls_owner;
revoke all on function public.mark_notification_retry(uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.mark_notification_retry(uuid, text, timestamptz) to service_role;

------------------------------------------------------------------------------
-- public.mark_notification_failed — processing -> failed, PERMANENT (4xx). No
-- retry is scheduled regardless of attempt_count. Appends a failed attempt.
------------------------------------------------------------------------------
create or replace function public.mark_notification_failed(
  p_notification_id uuid,
  p_error_code text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_row public.notifications%rowtype;
  v_attempt smallint;
begin
  select * into v_row from public.notifications where id = p_notification_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'NOTIFICATION_NOT_FOUND';
  end if;
  if v_row.status <> 'processing' then
    raise exception using errcode = 'P0001', message = 'NOTIFICATION_NOT_PROCESSING';
  end if;

  v_attempt := (v_row.attempt_count + 1)::smallint;

  update public.notifications
  set status = 'failed',
      attempt_count = v_attempt,
      next_attempt_at = null,
      failed_at = clock_timestamp(),
      locked_at = null,
      locked_by = null,
      last_error_code = p_error_code,
      last_error_message = p_error_code
  where id = p_notification_id;

  perform private.record_notification_attempt(
    p_notification_id, v_row.organization_id, v_attempt, 'failed', coalesce(v_row.locked_at, clock_timestamp()), p_error_code
  );

  return jsonb_build_object('id', p_notification_id, 'status', 'failed', 'attemptCount', v_attempt, 'terminal', true);
end;
$$;

alter function public.mark_notification_failed(uuid, text) owner to renoly_rls_owner;
revoke all on function public.mark_notification_failed(uuid, text) from public, anon, authenticated;
grant execute on function public.mark_notification_failed(uuid, text) to service_role;

------------------------------------------------------------------------------
-- public.requeue_stale_notifications — watchdog. Rows stuck in processing whose
-- locked_at is older than p_threshold_minutes are returned to pending with their
-- lock cleared. service_role only. Returns { requeued: int }.
------------------------------------------------------------------------------
create or replace function public.requeue_stale_notifications(
  p_now timestamptz default null,
  p_threshold_minutes integer default 5
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_now timestamptz := coalesce(p_now, clock_timestamp());
  v_threshold integer := greatest(1, coalesce(p_threshold_minutes, 5));
  v_count integer;
begin
  with stale as (
    select id from public.notifications
    where status = 'processing'
      and locked_at is not null
      and locked_at <= v_now - (v_threshold || ' minutes')::interval
    for update skip locked
  )
  update public.notifications n
  set status = 'pending',
      locked_at = null,
      locked_by = null,
      next_attempt_at = v_now
  from stale s
  where n.id = s.id;
  get diagnostics v_count = row_count;

  return jsonb_build_object('requeued', v_count);
end;
$$;

alter function public.requeue_stale_notifications(timestamptz, integer) owner to renoly_rls_owner;
revoke all on function public.requeue_stale_notifications(timestamptz, integer) from public, anon, authenticated;
grant execute on function public.requeue_stale_notifications(timestamptz, integer) to service_role;

------------------------------------------------------------------------------
-- public.cancel_notification — staff-facing. Cancels a pending/failed row.
-- owner/admin/dispatcher only; tenant + from-state guarded. authenticated.
------------------------------------------------------------------------------
create or replace function public.cancel_notification(
  target_org uuid,
  p_notification_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_row public.notifications%rowtype;
begin
  if not public.has_org_role(target_org, array['owner', 'admin', 'dispatcher']::text[]) then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;

  select * into v_row
  from public.notifications
  where organization_id = target_org and id = p_notification_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'NOTIFICATION_NOT_FOUND';
  end if;
  if v_row.status not in ('pending', 'failed') then
    raise exception using errcode = 'P0001', message = 'NOTIFICATION_NOT_CANCELLABLE';
  end if;

  update public.notifications
  set status = 'cancelled',
      cancelled_at = clock_timestamp(),
      next_attempt_at = null,
      locked_at = null,
      locked_by = null
  where id = p_notification_id;

  return jsonb_build_object('id', p_notification_id, 'status', 'cancelled');
end;
$$;

alter function public.cancel_notification(uuid, uuid) owner to renoly_rls_owner;
revoke all on function public.cancel_notification(uuid, uuid) from public, anon, service_role;
grant execute on function public.cancel_notification(uuid, uuid) to authenticated;

------------------------------------------------------------------------------
-- public.retry_notification — staff-facing manual resend. failed -> pending with
-- next_attempt_at = now (immediate re-claim). owner/admin/dispatcher only.
------------------------------------------------------------------------------
create or replace function public.retry_notification(
  target_org uuid,
  p_notification_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_row public.notifications%rowtype;
begin
  if not public.has_org_role(target_org, array['owner', 'admin', 'dispatcher']::text[]) then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;

  select * into v_row
  from public.notifications
  where organization_id = target_org and id = p_notification_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'NOTIFICATION_NOT_FOUND';
  end if;
  if v_row.status <> 'failed' then
    raise exception using errcode = 'P0001', message = 'NOTIFICATION_NOT_RETRYABLE';
  end if;

  -- Reset the exhausted counter one step so the claim query (attempt_count < max)
  -- will pick it up again after an operator explicitly asks to resend.
  update public.notifications
  set status = 'pending',
      attempt_count = least(v_row.attempt_count, (v_row.max_attempts - 1))::smallint,
      next_attempt_at = clock_timestamp(),
      failed_at = null,
      locked_at = null,
      locked_by = null
  where id = p_notification_id;

  return jsonb_build_object('id', p_notification_id, 'status', 'pending');
end;
$$;

alter function public.retry_notification(uuid, uuid) owner to renoly_rls_owner;
revoke all on function public.retry_notification(uuid, uuid) from public, anon, service_role;
grant execute on function public.retry_notification(uuid, uuid) to authenticated;

------------------------------------------------------------------------------
-- public.ingest_line_webhook_event — insert-only inbox landing. Resolves the org
-- from the channel, respects BOTH dedupe uniques (event_id / fallback sha256),
-- touches last_webhook_at, returns { duplicate: bool, id: uuid|null }.
-- service_role only (the webhook route runs with the admin client).
------------------------------------------------------------------------------
create or replace function public.ingest_line_webhook_event(
  p_channel_id uuid,
  p_webhook_event_id text,
  p_event_type text,
  p_event_timestamp timestamptz,
  p_payload jsonb,
  p_payload_sha256 text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_org uuid;
  v_id uuid;
begin
  select organization_id into v_org from public.line_channels where id = p_channel_id;
  if v_org is null then
    raise exception using errcode = 'P0002', message = 'LINE_CHANNEL_NOT_FOUND';
  end if;

  insert into public.line_webhook_events (
    organization_id, line_channel_id, webhook_event_id, event_type,
    event_timestamp, payload, payload_sha256, status
  ) values (
    v_org, p_channel_id, p_webhook_event_id, p_event_type,
    p_event_timestamp, p_payload, p_payload_sha256, 'pending'
  )
  on conflict do nothing
  returning id into v_id;

  -- Durable receipt marker even for duplicates (LINE retried delivery of a
  -- webhook it already sent; the channel is provably still receiving).
  update public.line_channels
  set last_webhook_at = clock_timestamp()
  where id = p_channel_id;

  if v_id is null then
    return jsonb_build_object('duplicate', true, 'id', null);
  end if;
  return jsonb_build_object('duplicate', false, 'id', v_id);
end;
$$;

alter function public.ingest_line_webhook_event(uuid, text, text, timestamptz, jsonb, text)
  owner to renoly_rls_owner;
revoke all on function public.ingest_line_webhook_event(uuid, text, text, timestamptz, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.ingest_line_webhook_event(uuid, text, text, timestamptz, jsonb, text) to service_role;

------------------------------------------------------------------------------
-- public.claim_line_webhook_events — inbox worker claim. SKIP LOCKED over the
-- claim partial index; pending/failed + due -> processing. service_role only.
------------------------------------------------------------------------------
create or replace function public.claim_line_webhook_events(
  p_worker_id text,
  p_limit integer default 10,
  p_now timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_now timestamptz := coalesce(p_now, clock_timestamp());
  v_limit integer := greatest(1, least(coalesce(p_limit, 10), 50));
  v_result jsonb;
begin
  with claimable as (
    select w.id from public.line_webhook_events w
    where w.status in ('pending', 'failed')
      and coalesce(w.next_attempt_at, w.received_at) <= v_now
    order by coalesce(w.next_attempt_at, w.received_at), w.received_at, w.id
    limit v_limit
    for update skip locked
  ),
  claimed as (
    update public.line_webhook_events w
    set status = 'processing', locked_at = v_now
    from claimable c
    where w.id = c.id
    returning w.id, w.organization_id, w.line_channel_id, w.webhook_event_id,
      w.event_type, w.event_timestamp, w.payload, w.attempt_count
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id,
    'organizationId', organization_id,
    'lineChannelId', line_channel_id,
    'webhookEventId', webhook_event_id,
    'eventType', event_type,
    'eventTimestamp', event_timestamp,
    'claimedBy', p_worker_id,
    'payload', payload,
    'attemptCount', attempt_count
  )), '[]'::jsonb)
  into v_result
  from claimed;

  return v_result;
end;
$$;

alter function public.claim_line_webhook_events(text, integer, timestamptz) owner to renoly_rls_owner;
revoke all on function public.claim_line_webhook_events(text, integer, timestamptz) from public, anon, authenticated;
grant execute on function public.claim_line_webhook_events(text, integer, timestamptz) to service_role;

------------------------------------------------------------------------------
-- Webhook terminal transitions. Each guards from-state = processing.
------------------------------------------------------------------------------
create or replace function private.mark_webhook_terminal(
  p_event_id uuid,
  p_status text,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_row public.line_webhook_events%rowtype;
  v_next timestamptz := null;
  v_attempt smallint;
begin
  select * into v_row from public.line_webhook_events where id = p_event_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'WEBHOOK_EVENT_NOT_FOUND';
  end if;
  if v_row.status <> 'processing' then
    raise exception using errcode = 'P0001', message = 'WEBHOOK_NOT_PROCESSING';
  end if;

  v_attempt := (v_row.attempt_count + 1)::smallint;
  if p_status = 'failed' then
    v_next := clock_timestamp() + private.notification_backoff_delay(v_attempt::integer);
  end if;

  update public.line_webhook_events
  set status = case when p_status = 'failed' and v_attempt < 100 then 'failed' else p_status end,
      processed_at = case when p_status in ('processed', 'ignored') then clock_timestamp() else processed_at end,
      attempt_count = v_attempt,
      next_attempt_at = case when p_status = 'failed' then v_next else null end,
      locked_at = null,
      error_code = case when p_status = 'failed' then p_note else null end
  where id = p_event_id;

  return jsonb_build_object('id', p_event_id, 'status', p_status);
end;
$$;

alter function private.mark_webhook_terminal(uuid, text, text) owner to renoly_rls_owner;
revoke all on function private.mark_webhook_terminal(uuid, text, text)
  from public, anon, authenticated, service_role;

create or replace function public.mark_webhook_processed(p_event_id uuid, p_note text default null)
returns jsonb
language sql
security definer
set search_path = pg_catalog, public, private
as $$ select private.mark_webhook_terminal(p_event_id, 'processed', p_note); $$;

create or replace function public.mark_webhook_ignored(p_event_id uuid, p_note text default null)
returns jsonb
language sql
security definer
set search_path = pg_catalog, public, private
as $$ select private.mark_webhook_terminal(p_event_id, 'ignored', p_note); $$;

create or replace function public.mark_webhook_failed(p_event_id uuid, p_error_code text default null)
returns jsonb
language sql
security definer
set search_path = pg_catalog, public, private
as $$ select private.mark_webhook_terminal(p_event_id, 'failed', p_error_code); $$;

alter function public.mark_webhook_processed(uuid, text) owner to renoly_rls_owner;
alter function public.mark_webhook_ignored(uuid, text) owner to renoly_rls_owner;
alter function public.mark_webhook_failed(uuid, text) owner to renoly_rls_owner;
revoke all on function public.mark_webhook_processed(uuid, text) from public, anon, authenticated;
revoke all on function public.mark_webhook_ignored(uuid, text) from public, anon, authenticated;
revoke all on function public.mark_webhook_failed(uuid, text) from public, anon, authenticated;
grant execute on function public.mark_webhook_processed(uuid, text) to service_role;
grant execute on function public.mark_webhook_ignored(uuid, text) to service_role;
grant execute on function public.mark_webhook_failed(uuid, text) to service_role;

------------------------------------------------------------------------------
-- public.disable_line_channel — kill switch. owner/admin only. Sets status
-- 'disabled' and appends a hash-chained line_channel audit event. authenticated.
------------------------------------------------------------------------------
create or replace function public.disable_line_channel(
  target_org uuid,
  p_channel_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_row public.line_channels%rowtype;
begin
  if not public.has_org_role(target_org, array['owner', 'admin']::text[]) then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;

  select * into v_row
  from public.line_channels
  where organization_id = target_org and id = p_channel_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'LINE_CHANNEL_NOT_FOUND';
  end if;

  if v_row.status <> 'disabled' then
    update public.line_channels
    set status = 'disabled',
        updated_by = (select private.current_actor_user_id()),
        lock_version = v_row.lock_version + 1
    where id = p_channel_id;

    perform private.append_user_event(
      target_org, 'line_channel', p_channel_id, 'line_channel.disabled',
      jsonb_build_object('reason', p_reason, 'previousStatus', v_row.status),
      null, null, null
    );
  end if;

  return jsonb_build_object('id', p_channel_id, 'status', 'disabled');
end;
$$;

alter function public.disable_line_channel(uuid, uuid, text) owner to renoly_rls_owner;
revoke all on function public.disable_line_channel(uuid, uuid, text) from public, anon, service_role;
grant execute on function public.disable_line_channel(uuid, uuid, text) to authenticated;
