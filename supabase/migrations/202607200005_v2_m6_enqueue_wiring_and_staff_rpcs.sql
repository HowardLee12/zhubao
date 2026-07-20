-- Renoly v2 M6 (Wave C) — enqueue wiring + staff-facing LINE channel & outbox RPCs.
--
-- This migration does NOT change schema. It:
--   1. Adds private.enqueue_customer_line_notification — a reusable helper that
--      resolves an org's active LINE channel + a customer's bound LINE identity and
--      enqueues a customer notification in the SAME transaction as the triggering
--      mutation (via private.enqueue_notification from 202607200004). When no LINE
--      recipient can be resolved it is a no-op and reports why, so an org that has
--      not connected LINE still completes its mutation (LINE is not load-bearing).
--   2. CREATE OR REPLACEs the three M5 mutation RPCs that previously wrote a
--      { status: 'not_sent', reason: 'line_delivery_deferred_to_m6' } stub into
--      their event payload: schedule_work_order, force_complete_work_order and
--      approve_and_send_pilot_quote. Each now enqueues the real customer
--      notification and records the enqueue outcome in the event's notification
--      block ('pending' when enqueued, 'skipped' when no LINE recipient). We
--      re-emit the authoritative end-state grants/owner for each function.
--   3. Adds the staff read RPCs the outbox UI needs (authenticated; org-role gated
--      INTERNAL): list_notifications + get_notification_detail, returning a REDACTED
--      shape — status/attempt counters/lastErrorCode/hasProviderMessage only, never
--      the payload, provider_message_id or any secret/cost material.
--   4. Adds the staff LINE-channel management RPCs: connect_line_channel (stores the
--      AES-256-GCM ciphertext the app encrypted — the RPC never sees plaintext),
--      rotate_line_channel_token, verify_line_channel, list_line_channels and
--      get_line_channel (redacted DTO — credentialConfigured boolean only).
--
-- Role boundary: enqueue helper is private (no PostgREST grant). Staff RPCs are
-- authenticated with an INTERNAL owner/admin(/dispatcher) gate via has_org_role.

set search_path = pg_catalog, public, private, extensions;

------------------------------------------------------------------------------
-- private.enqueue_customer_line_notification — resolve active channel + the
-- customer's LINE identity, then enqueue. Returns jsonb describing the outcome:
--   { status: 'pending',  notificationId, enqueued }        (recipient resolved)
--   { status: 'skipped',  reason: 'no_active_line_channel' }
--   { status: 'skipped',  reason: 'no_line_recipient' }     (customer not bound)
-- dedupe_key collapses transition replays to a single outbox row.
------------------------------------------------------------------------------
create or replace function private.enqueue_customer_line_notification(
  target_org uuid,
  p_customer_id uuid,
  p_template_key text,
  p_template_version integer,
  p_payload jsonb,
  p_dedupe_key text,
  p_related_type text,
  p_related_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_channel_id uuid;
  v_identity_id uuid;
  v_enqueue jsonb;
begin
  -- One active channel per org (enforced by a partial unique elsewhere); pick it.
  select id into v_channel_id
  from public.line_channels
  where organization_id = target_org and status = 'active'
  order by created_at, id
  limit 1;

  if v_channel_id is null then
    return jsonb_build_object('status', 'skipped', 'reason', 'no_active_line_channel');
  end if;

  -- The customer must have a LINE identity bound to THIS channel to receive a push.
  select id into v_identity_id
  from public.customer_line_identities
  where organization_id = target_org
    and customer_id = p_customer_id
    and line_channel_id = v_channel_id
    and friend_status <> 'blocked'
  order by created_at, id
  limit 1;

  if v_identity_id is null then
    return jsonb_build_object('status', 'skipped', 'reason', 'no_line_recipient');
  end if;

  v_enqueue := private.enqueue_notification(
    target_org, 'line', v_channel_id, p_template_key, p_template_version,
    coalesce(p_payload, '{}'::jsonb), p_dedupe_key, p_related_type, p_related_id,
    v_identity_id, null, 'not_required', null
  );

  return jsonb_build_object(
    'status', 'pending',
    'enqueued', v_enqueue -> 'enqueued',
    'notificationId', v_enqueue -> 'notificationId'
  );
end;
$$;

alter function private.enqueue_customer_line_notification(uuid, uuid, text, integer, jsonb, text, text, uuid)
  owner to renoly_rls_owner;
revoke all on function private.enqueue_customer_line_notification(uuid, uuid, text, integer, jsonb, text, text, uuid)
  from public, anon, authenticated, service_role;

------------------------------------------------------------------------------
-- Rewired schedule_work_order — enqueues appointment_confirmed in-txn.
------------------------------------------------------------------------------
create or replace function public.schedule_work_order(
  target_org uuid,
  target_work_order uuid,
  p_scheduled_start_at timestamptz,
  p_scheduled_end_at timestamptz,
  p_assignments jsonb,
  p_expected_lock_version integer,
  p_occurred_at timestamptz,
  p_conflict_override_reason text default null,
  p_idempotency_key text default null,
  p_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_actor uuid := (select private.current_actor_user_id());
  v_work public.work_orders%rowtype;
  v_is_owner boolean;
  v_member_ids uuid[];
  v_assignment jsonb;
  v_membership uuid;
  v_duty text;
  v_conflicts jsonb;
  v_count integer;
  v_notify jsonb;
begin
  if not public.has_org_role(target_org, array['owner', 'admin', 'dispatcher']::text[]) then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;
  v_is_owner := public.has_org_role(target_org, array['owner', 'admin']::text[]);

  if p_scheduled_start_at is null or p_scheduled_end_at is null
     or not isfinite(p_scheduled_start_at) or not isfinite(p_scheduled_end_at)
     or p_scheduled_end_at <= p_scheduled_start_at
     or p_assignments is null or jsonb_typeof(p_assignments) <> 'array'
     or jsonb_array_length(p_assignments) = 0
     or jsonb_array_length(p_assignments) > 20 then
    raise exception using errcode = '22023', message = 'SCHEDULE_PAYLOAD_INVALID';
  end if;

  select * into v_work
  from public.work_orders
  where organization_id = target_org and id = target_work_order
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'WORK_ORDER_NOT_FOUND';
  end if;
  if v_work.lock_version is distinct from p_expected_lock_version then
    raise exception using errcode = '40001', message = 'STALE_VERSION';
  end if;
  if v_work.status <> 'draft' then
    raise exception using errcode = '23514', message = 'WORK_ORDER_NOT_SCHEDULABLE';
  end if;

  -- Collect and validate the assignment set.
  v_member_ids := array[]::uuid[];
  for v_assignment in select * from jsonb_array_elements(p_assignments)
  loop
    if jsonb_typeof(v_assignment) <> 'object'
       or nullif(btrim(v_assignment ->> 'membershipId'), '') is null
       or coalesce(v_assignment ->> 'duty', 'technician') not in ('lead', 'technician', 'helper', 'observer') then
      raise exception using errcode = '22023', message = 'SCHEDULE_PAYLOAD_INVALID';
    end if;
    v_member_ids := v_member_ids || (v_assignment ->> 'membershipId')::uuid;
  end loop;
  if array_length(v_member_ids, 1) is distinct from (
    select count(distinct x) from unnest(v_member_ids) x
  ) then
    raise exception using errcode = '22023', message = 'SCHEDULE_DUPLICATE_MEMBER';
  end if;

  -- Conflict detection: same members overlapping non-terminal work orders.
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'membershipId', a.membership_id,
      'workOrderId', wo.id,
      'workOrderNo', wo.work_order_no,
      'startsAt', wo.scheduled_start_at,
      'endsAt', wo.scheduled_end_at
    ) order by wo.scheduled_start_at, wo.id
  ), '[]'::jsonb)
  into v_conflicts
  from public.assignments a
  join public.work_orders wo
    on wo.organization_id = a.organization_id and wo.id = a.work_order_id
  where a.organization_id = target_org
    and a.membership_id = any(v_member_ids)
    and a.status in ('assigned', 'accepted', 'checked_in')
    and wo.id <> target_work_order
    and wo.status not in ('draft', 'completed', 'cancelled')
    and wo.scheduled_start_at is not null
    and wo.scheduled_end_at is not null
    and wo.scheduled_start_at < p_scheduled_end_at
    and wo.scheduled_end_at > p_scheduled_start_at;

  if jsonb_array_length(v_conflicts) > 0 then
    if not v_is_owner or nullif(btrim(p_conflict_override_reason), '') is null then
      raise exception using errcode = 'RENSC',
        message = 'SCHEDULE_CONFLICT',
        detail = v_conflicts::text;
    end if;
  end if;

  -- Write the schedule window first so transition_work_order's SCHEDULE_REQUIRED
  -- and ACTIVE_ASSIGNMENT_REQUIRED gates are satisfied within this transaction.
  update public.work_orders
  set scheduled_start_at = p_scheduled_start_at,
      scheduled_end_at = p_scheduled_end_at,
      updated_by = v_actor,
      lock_version = lock_version + 1
  where organization_id = target_org and id = target_work_order
  returning lock_version into v_count;

  -- (Re)create assignments. Existing active assignments for the same member are
  -- kept; new members are inserted as 'assigned'. Members not in the new set that
  -- are currently active are cancelled so the schedule reflects the new roster.
  for v_assignment in select * from jsonb_array_elements(p_assignments)
  loop
    v_membership := (v_assignment ->> 'membershipId')::uuid;
    v_duty := coalesce(v_assignment ->> 'duty', 'technician');
    insert into public.assignments (
      organization_id, work_order_id, membership_id, duty, status,
      assigned_by, created_by, updated_by
    ) values (
      target_org, target_work_order, v_membership, v_duty, 'assigned',
      v_actor, v_actor, v_actor
    )
    on conflict (organization_id, work_order_id, membership_id) do update
    set duty = excluded.duty,
        status = case
          when public.assignments.status in ('declined', 'cancelled') then 'assigned'
          else public.assignments.status
        end,
        cancelled_at = null,
        declined_at = null,
        decline_reason = null,
        updated_by = v_actor,
        lock_version = public.assignments.lock_version + 1;
  end loop;

  update public.assignments a
  set status = 'cancelled',
      cancelled_at = statement_timestamp(),
      updated_by = v_actor,
      lock_version = a.lock_version + 1
  where a.organization_id = target_org
    and a.work_order_id = target_work_order
    and a.status in ('assigned', 'accepted', 'checked_in')
    and not (a.membership_id = any(v_member_ids));

  -- Authoritative gate + status change + event (draft -> scheduled).
  perform public.transition_work_order(
    target_org, target_work_order, 'scheduled', v_count, p_occurred_at,
    p_conflict_override_reason, null, null, p_request_id, p_idempotency_key
  );

  -- Enqueue the customer appointment-confirmed LINE notification in THIS txn.
  v_notify := private.enqueue_customer_line_notification(
    target_org, v_work.customer_id, 'appointment_confirmed', 1,
    jsonb_build_object('workOrderNumber', v_work.work_order_no),
    'wo:' || target_work_order::text || ':appointment_confirmed',
    'work_order', target_work_order
  );

  perform private.append_user_event(
    target_org, 'work_order', target_work_order, 'work_order.scheduled_dispatch',
    jsonb_build_object(
      'scheduledStartAt', p_scheduled_start_at,
      'scheduledEndAt', p_scheduled_end_at,
      'assignmentCount', jsonb_array_length(p_assignments),
      'conflictOverride', jsonb_array_length(v_conflicts) > 0,
      'notification', v_notify
    ),
    p_request_id, null, p_occurred_at
  );

  return private.work_order_detail_json(target_org, target_work_order, true);
end;
$$;

alter function public.schedule_work_order(uuid, uuid, timestamptz, timestamptz, jsonb, integer, timestamptz, text, text, uuid)
  owner to renoly_rls_owner;
revoke all on function public.schedule_work_order(uuid, uuid, timestamptz, timestamptz, jsonb, integer, timestamptz, text, text, uuid)
  from public, anon, service_role;
grant execute on function public.schedule_work_order(uuid, uuid, timestamptz, timestamptz, jsonb, integer, timestamptz, text, text, uuid)
  to authenticated;

------------------------------------------------------------------------------
-- Rewired force_complete_work_order — enqueues completed in-txn.
------------------------------------------------------------------------------
create or replace function public.force_complete_work_order(
  target_org uuid,
  target_work_order uuid,
  p_reason text,
  p_completion_summary text,
  p_expected_lock_version integer,
  p_occurred_at timestamptz,
  p_idempotency_key text default null,
  p_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_actor uuid := (select private.current_actor_user_id());
  v_work public.work_orders%rowtype;
  v_missing jsonb;
  v_notify jsonb;
begin
  if not public.has_org_role(target_org, array['owner', 'admin']::text[]) then
    raise exception using errcode = '42501', message = 'FORCE_COMPLETE_REQUIRES_OWNER';
  end if;
  if nullif(btrim(p_reason), '') is null then
    raise exception using errcode = '23514', message = 'FORCE_COMPLETE_REASON_REQUIRED';
  end if;
  if nullif(btrim(p_completion_summary), '') is null then
    raise exception using errcode = '23514', message = 'COMPLETION_SUMMARY_REQUIRED';
  end if;
  if p_occurred_at is null or not isfinite(p_occurred_at) then
    raise exception using errcode = '22023', message = 'OCCURRED_AT_REQUIRED';
  end if;
  if p_occurred_at > statement_timestamp() + interval '5 minutes'
     or p_occurred_at < statement_timestamp() - interval '30 days' then
    raise exception using errcode = '22023', message = 'OCCURRED_AT_OUT_OF_RANGE';
  end if;

  select * into v_work
  from public.work_orders
  where organization_id = target_org and id = target_work_order
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'WORK_ORDER_NOT_FOUND';
  end if;
  if v_work.lock_version is distinct from p_expected_lock_version then
    raise exception using errcode = '40001', message = 'STALE_VERSION';
  end if;
  if v_work.status not in ('on_site', 'paused') then
    raise exception using errcode = '23514', message = 'INVALID_WORK_ORDER_TRANSITION';
  end if;

  -- Snapshot which gates were bypassed for the audit event.
  v_missing := jsonb_build_object(
    'requiredChecklistIncomplete', exists (
      select 1 from public.work_order_checklist_items ci
      where ci.organization_id = target_org and ci.work_order_id = target_work_order
        and ci.is_required and not private.checklist_item_answered(ci)
    ),
    'requiredEvidenceMissing', exists (
      select 1 from public.work_order_checklist_items ci
      where ci.organization_id = target_org and ci.work_order_id = target_work_order
        and ci.evidence_required
        and not exists (
          select 1 from public.photos p
          where p.organization_id = ci.organization_id and p.checklist_item_id = ci.id
            and p.status = 'ready' and p.deleted_at is null
        )
    ),
    'missingBeforePhoto', not exists (
      select 1 from public.photos p
      where p.organization_id = target_org and p.work_order_id = target_work_order
        and p.category = 'before' and p.status = 'ready' and p.deleted_at is null
    ),
    'missingAfterPhoto', not exists (
      select 1 from public.photos p
      where p.organization_id = target_org and p.work_order_id = target_work_order
        and p.category = 'after' and p.status = 'ready' and p.deleted_at is null
    )
  );

  -- Direct completion: NEVER touch customer_signed_at (force-complete is not a
  -- customer sign-off). requires_customer_signoff would block a plain complete;
  -- force-complete is an explicit owner override recorded as such.
  update public.work_orders
  set status = 'completed',
      completed_at = p_occurred_at,
      completion_summary = p_completion_summary,
      updated_by = v_actor,
      lock_version = lock_version + 1
  where organization_id = target_org and id = target_work_order;

  if v_work.asset_id is not null then
    update public.assets
    set last_serviced_at = p_occurred_at,
        updated_by = v_actor,
        lock_version = lock_version + 1
    where organization_id = target_org and id = v_work.asset_id;
  end if;

  -- Enqueue the customer completed LINE notification in THIS txn.
  v_notify := private.enqueue_customer_line_notification(
    target_org, v_work.customer_id, 'completed', 1,
    jsonb_build_object('workOrderNumber', v_work.work_order_no),
    'wo:' || target_work_order::text || ':completed',
    'work_order', target_work_order
  );

  perform private.append_user_event(
    target_org, 'work_order', target_work_order, 'work_order.force_completed',
    jsonb_build_object(
      'from', v_work.status,
      'to', 'completed',
      'overrideReason', p_reason,
      'bypassedGates', v_missing,
      'customerSignoff', false,
      'notification', v_notify
    ),
    p_request_id, p_idempotency_key, p_occurred_at
  );

  return private.work_order_detail_json(target_org, target_work_order, true);
end;
$$;

alter function public.force_complete_work_order(uuid, uuid, text, text, integer, timestamptz, text, uuid)
  owner to renoly_rls_owner;
revoke all on function public.force_complete_work_order(uuid, uuid, text, text, integer, timestamptz, text, uuid)
  from public, anon, service_role;
grant execute on function public.force_complete_work_order(uuid, uuid, text, text, integer, timestamptz, text, uuid)
  to authenticated;

------------------------------------------------------------------------------
-- Rewired approve_and_send_pilot_quote — enqueues quote_sent in-txn.
------------------------------------------------------------------------------
create or replace function public.approve_and_send_pilot_quote(
  p_organization_id uuid,
  p_quote_id uuid,
  p_version_id uuid,
  p_expected_quote_lock_version integer,
  p_expected_request_lock_version integer,
  p_public_token_hash_hex text,
  p_idempotency_key text,
  p_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, extensions
as $$
declare
  v_actor uuid := (select private.current_actor_user_id());
  v_quote public.quotes%rowtype;
  v_version public.quote_versions%rowtype;
  v_request public.service_requests%rowtype;
  v_token_hash bytea;
  v_expires_at timestamptz;
  v_quote_expires_at timestamptz;
  v_today date;
  v_timezone text;
  v_count integer;
  v_subtotal bigint;
  v_discount bigint;
  v_tax bigint;
  v_total bigint;
  v_actor_fingerprint text;
  v_request_hash text;
  v_idempotency public.idempotency_keys%rowtype;
  v_inserted integer;
  v_workspace jsonb;
  v_notify jsonb;
begin
  if not public.has_org_role(
    p_organization_id, array['owner', 'admin']::text[]
  ) then
    raise exception using errcode = '42501', message = 'QUOTE_SEND_ROLE_REQUIRED';
  end if;
  if nullif(btrim(p_idempotency_key), '') is null
     or char_length(p_idempotency_key) not between 8 and 128 then
    raise exception using errcode = '22023', message = 'PILOT_VALIDATION_FAILED';
  end if;

  v_token_hash := private.decode_pilot_sha256_hex(
    p_public_token_hash_hex, 'PILOT_VALIDATION_FAILED'
  );
  v_actor_fingerprint := 'pilot-quote-send:' || v_actor::text || ':' || p_quote_id::text;
  v_request_hash := encode(extensions.digest(
    p_organization_id::text || '|' || p_quote_id::text || '|' || p_version_id::text,
    'sha256'
  ), 'hex');

  insert into public.idempotency_keys (
    organization_id, actor_fingerprint, method, path_template,
    idempotency_key, request_hash, state, resource_type, resource_id,
    locked_until, expires_at
  ) values (
    p_organization_id, v_actor_fingerprint, 'POST',
    '/api/v2/organizations/{orgId}/quotes/{id}/actions/send',
    p_idempotency_key, v_request_hash, 'processing', 'quote', p_quote_id,
    clock_timestamp() + interval '2 minutes', clock_timestamp() + interval '24 hours'
  )
  on conflict (actor_fingerprint, method, path_template, idempotency_key) do nothing
  returning * into v_idempotency;
  get diagnostics v_inserted = row_count;

  if v_inserted = 0 then
    select * into v_idempotency
    from public.idempotency_keys
    where actor_fingerprint = v_actor_fingerprint
      and method = 'POST'
      and path_template = '/api/v2/organizations/{orgId}/quotes/{id}/actions/send'
      and idempotency_key = p_idempotency_key
    for update;

    if v_idempotency.request_hash is distinct from v_request_hash then
      raise exception using errcode = '22023', message = 'PILOT_IDEMPOTENCY_CONFLICT';
    end if;
    if v_idempotency.state = 'completed' then
      select q.* into v_quote
      from public.quotes q
      join public.quote_versions qv
        on qv.organization_id = q.organization_id and qv.id = q.active_version_id
      where q.organization_id = p_organization_id
        and q.id = p_quote_id and qv.id = p_version_id;

      if not found then
        raise exception using errcode = 'P0002', message = 'QUOTE_NOT_FOUND';
      end if;
      select * into v_version
      from public.quote_versions
      where organization_id = p_organization_id and id = p_version_id;
      -- The API deterministically derives the capability from this mutation's
      -- idempotency key. A completed retry must therefore reference the same
      -- still-active hash and return the exact same URL without rotating it.
      if not exists (
        select 1 from public.public_access_tokens pat
        where pat.organization_id = p_organization_id
          and pat.resource_type = 'quote'
          and pat.resource_id = p_version_id
          and pat.token_hash = v_token_hash
          and pat.revoked_at is null
          and pat.expires_at > statement_timestamp()
      ) then
        raise exception using errcode = '22023', message = 'PILOT_IDEMPOTENCY_CONFLICT';
      end if;

      return private.pilot_quote_workspace_json(p_organization_id, p_quote_id)
        || jsonb_build_object('replayed', true);
    end if;
    raise exception using errcode = '22023', message = 'PILOT_IDEMPOTENCY_IN_PROGRESS';
  end if;

  select q.* into v_quote
  from public.quotes q
  where q.organization_id = p_organization_id and q.id = p_quote_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'QUOTE_NOT_FOUND';
  end if;
  if v_quote.lock_version is distinct from p_expected_quote_lock_version then
    raise exception using errcode = '40001', message = 'STALE_VERSION';
  end if;
  if v_quote.latest_version_id is distinct from p_version_id
     or v_quote.status <> 'draft' then
    raise exception using errcode = '23514', message = 'ACTIVE_VERSION_CHANGED';
  end if;
  select timezone into v_timezone
  from public.organizations where id = p_organization_id;

  select * into v_version
  from public.quote_versions qv
  where qv.organization_id = p_organization_id
    and qv.id = p_version_id and qv.quote_id = p_quote_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'QUOTE_VERSION_NOT_FOUND';
  end if;
  if v_version.status <> 'draft'
     or v_version.approval_status not in ('not_submitted', 'changes_requested') then
    raise exception using errcode = '23514', message = 'QUOTE_VERSION_IMMUTABLE';
  end if;

  select * into v_request
  from public.service_requests sr
  where sr.organization_id = p_organization_id and sr.id = v_quote.service_request_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'SERVICE_REQUEST_NOT_FOUND';
  end if;
  if v_request.lock_version is distinct from p_expected_request_lock_version then
    raise exception using errcode = '40001', message = 'STALE_VERSION';
  end if;
  if v_request.status not in ('triaged', 'quoting', 'quoted') then
    raise exception using errcode = '23514', message = 'QUOTE_REQUEST_NOT_READY';
  end if;

  select count(*)::integer,
         coalesce(sum(qi.subtotal_minor), 0)::bigint as subtotal,
         coalesce(sum(qi.discount_minor), 0)::bigint as discount,
         coalesce(sum(qi.tax_minor), 0)::bigint as tax,
         coalesce(sum(qi.total_minor), 0)::bigint as total
  into v_count, v_subtotal, v_discount, v_tax, v_total
  from public.quote_items qi
  where qi.organization_id = p_organization_id
    and qi.quote_version_id = p_version_id;
  if v_count = 0 then
    raise exception using errcode = '23514', message = 'QUOTE_ITEMS_REQUIRED';
  end if;

  v_today := (statement_timestamp() at time zone v_timezone)::date;
  if v_version.valid_until is not null and v_version.valid_until < v_today then
    raise exception using errcode = '23514', message = 'QUOTE_ALREADY_EXPIRED';
  end if;
  v_quote_expires_at := case
    when v_version.valid_until is null then statement_timestamp() + interval '30 days'
    else (v_version.valid_until::timestamp + interval '1 day') at time zone v_timezone
  end;
  v_expires_at := least(statement_timestamp() + interval '30 days', v_quote_expires_at);

  update public.quote_versions
  set status = 'sent',
      approval_status = 'approved',
      submitted_for_approval_at = statement_timestamp(),
      submitted_for_approval_by = v_actor,
      approved_at = statement_timestamp(),
      approved_by = v_actor,
      approval_rejection_reason = null,
      subtotal_minor = v_subtotal,
      discount_minor = v_discount,
      tax_minor = v_tax,
      total_minor = v_total,
      sent_at = statement_timestamp(),
      updated_by = v_actor,
      lock_version = lock_version + 1
  where organization_id = p_organization_id and id = p_version_id;

  update public.public_access_tokens pat
  set revoked_at = statement_timestamp()
  where pat.organization_id = p_organization_id
    and pat.resource_type = 'quote'
    and pat.revoked_at is null
    and exists (
      select 1 from public.quote_versions old_version
      where old_version.organization_id = pat.organization_id
        and old_version.id = pat.resource_id
        and old_version.quote_id = p_quote_id
    );

  update public.quotes
  set status = 'sent',
      latest_version_id = p_version_id,
      active_version_id = p_version_id,
      accepted_version_id = null,
      sent_at = statement_timestamp(),
      first_viewed_at = null,
      accepted_at = null,
      rejected_at = null,
      rejection_reason = null,
      expires_at = v_quote_expires_at,
      updated_by = v_actor,
      lock_version = lock_version + 1
  where organization_id = p_organization_id and id = p_quote_id;

  update public.service_requests
  set status = 'quoted', quoted_at = statement_timestamp(),
      updated_by = v_actor, lock_version = lock_version + 1
  where organization_id = p_organization_id and id = v_quote.service_request_id;

  insert into public.public_access_tokens (
    organization_id, resource_type, resource_id, token_hash, scopes,
    expires_at, max_uses, created_by
  ) values (
    p_organization_id, 'quote', p_version_id, v_token_hash,
    array['quote:read', 'quote:respond']::text[], v_expires_at, null, v_actor
  );

  -- Enqueue the customer quote-sent LINE notification in THIS txn.
  v_notify := private.enqueue_customer_line_notification(
    p_organization_id, v_quote.customer_id, 'quote_sent', 1,
    jsonb_build_object('quoteNumber', v_quote.quote_no),
    'quote:' || p_version_id::text || ':quote_sent',
    'quote', p_quote_id
  );

  perform private.append_user_event(
    p_organization_id, 'quote', p_quote_id, 'quote.sent',
    jsonb_build_object(
      'quoteVersionId', p_version_id,
      'versionNo', v_version.version_no,
      'totalMinor', v_total,
      'validUntil', v_version.valid_until,
      'notification', v_notify
    ), p_request_id, p_idempotency_key
  );
  perform private.append_user_event(
    p_organization_id, 'service_request', v_quote.service_request_id,
    'service_request.quoted',
    jsonb_build_object(
      'from', v_request.status,
      'to', 'quoted',
      'quoteId', p_quote_id,
      'quoteVersionId', p_version_id
    ), p_request_id, p_idempotency_key
  );

  v_workspace := private.pilot_quote_workspace_json(p_organization_id, p_quote_id);
  update public.idempotency_keys
  set state = 'completed', response_status = 200, response_body = v_workspace,
      locked_until = null, updated_at = clock_timestamp()
  where id = v_idempotency.id;
  return v_workspace;
end;
$$;

alter function public.approve_and_send_pilot_quote(uuid, uuid, uuid, integer, integer, text, text, uuid)
  owner to renoly_rls_owner;
revoke all on function public.approve_and_send_pilot_quote(uuid, uuid, uuid, integer, integer, text, text, uuid)
  from public, anon, service_role;
grant execute on function public.approve_and_send_pilot_quote(uuid, uuid, uuid, integer, integer, text, text, uuid)
  to authenticated;

------------------------------------------------------------------------------
-- public.list_notifications — staff outbox list (REDACTED). owner/admin/
-- dispatcher only. Keyset on (created_at desc, id desc). Never exposes payload,
-- provider_message_id, cost or secret material — only operational status.
------------------------------------------------------------------------------
create or replace function public.list_notifications(
  target_org uuid,
  p_status text default null,
  p_channel text default null,
  p_related_type text default null,
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null,
  p_page_size integer default 20
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_page_size, 20), 100));
  v_items jsonb;
begin
  if not public.has_org_role(target_org, array['owner', 'admin', 'dispatcher']::text[]) then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;

  select coalesce(jsonb_agg(row_json order by created_at desc, id desc), '[]'::jsonb)
  into v_items
  from (
    select n.created_at, n.id, jsonb_build_object(
      'id', n.id,
      'channel', n.channel,
      'templateKey', n.template_key,
      'templateVersion', n.template_version,
      'status', n.status,
      'approvalStatus', n.approval_status,
      'attemptCount', n.attempt_count,
      'maxAttempts', n.max_attempts,
      'lastErrorCode', n.last_error_code,
      'hasProviderMessage', n.provider_message_id is not null,
      'relatedType', n.related_type,
      'relatedId', n.related_id,
      'scheduledAt', n.scheduled_at,
      'nextAttemptAt', n.next_attempt_at,
      'sentAt', n.sent_at,
      'failedAt', n.failed_at,
      'cancelledAt', n.cancelled_at,
      'createdAt', n.created_at
    ) as row_json
    from public.notifications n
    where n.organization_id = target_org
      and (p_status is null or n.status = p_status)
      and (p_channel is null or n.channel = p_channel)
      and (p_related_type is null or n.related_type = p_related_type)
      and (
        p_cursor_created_at is null or p_cursor_id is null
        or (n.created_at, n.id) < (p_cursor_created_at, p_cursor_id)
      )
    order by n.created_at desc, n.id desc
    limit v_limit
  ) ranked;

  return jsonb_build_object('organizationId', target_org, 'items', v_items);
end;
$$;

alter function public.list_notifications(uuid, text, text, text, timestamptz, uuid, integer)
  owner to renoly_rls_owner;
revoke all on function public.list_notifications(uuid, text, text, text, timestamptz, uuid, integer)
  from public, anon, service_role;
grant execute on function public.list_notifications(uuid, text, text, text, timestamptz, uuid, integer)
  to authenticated;

------------------------------------------------------------------------------
-- public.get_notification_detail — single redacted notification + its attempts
-- (attempt outcomes/error codes/timestamps only). owner/admin/dispatcher only.
-- Cross-tenant / missing collapses to NOTIFICATION_NOT_FOUND.
------------------------------------------------------------------------------
create or replace function public.get_notification_detail(
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
  v_attempts jsonb;
begin
  if not public.has_org_role(target_org, array['owner', 'admin', 'dispatcher']::text[]) then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;

  select * into v_row
  from public.notifications
  where organization_id = target_org and id = p_notification_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'NOTIFICATION_NOT_FOUND';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'attemptNo', a.attempt_no,
    'outcome', a.outcome,
    'errorCode', a.error_code,
    'startedAt', a.started_at,
    'finishedAt', a.finished_at
  ) order by a.attempt_no), '[]'::jsonb)
  into v_attempts
  from public.notification_attempts a
  where a.organization_id = target_org and a.notification_id = p_notification_id;

  return jsonb_build_object(
    'id', v_row.id,
    'channel', v_row.channel,
    'templateKey', v_row.template_key,
    'templateVersion', v_row.template_version,
    'status', v_row.status,
    'approvalStatus', v_row.approval_status,
    'attemptCount', v_row.attempt_count,
    'maxAttempts', v_row.max_attempts,
    'lastErrorCode', v_row.last_error_code,
    'hasProviderMessage', v_row.provider_message_id is not null,
    'relatedType', v_row.related_type,
    'relatedId', v_row.related_id,
    'scheduledAt', v_row.scheduled_at,
    'nextAttemptAt', v_row.next_attempt_at,
    'sentAt', v_row.sent_at,
    'failedAt', v_row.failed_at,
    'cancelledAt', v_row.cancelled_at,
    'createdAt', v_row.created_at,
    'attempts', v_attempts
  );
end;
$$;

alter function public.get_notification_detail(uuid, uuid)
  owner to renoly_rls_owner;
revoke all on function public.get_notification_detail(uuid, uuid)
  from public, anon, service_role;
grant execute on function public.get_notification_detail(uuid, uuid)
  to authenticated;

------------------------------------------------------------------------------
-- LINE channel management (staff). The APPLICATION encrypts secret + token with
-- AES-256-GCM (credentials.ts) and passes ONLY ciphertext/nonce/keyVersion here;
-- these RPCs never see plaintext and never return any ciphertext to the client.
-- owner/admin only. One active channel per org is enforced by upserting the
-- single row keyed on (organization_id) — a second connect updates in place.
------------------------------------------------------------------------------
-- p_channel_row_id is the app-CHOSEN channel UUID. The app must encrypt the
-- credentials AAD-bound to this exact id BEFORE calling (see credentials.ts). To
-- keep one channel per org and preserve the AAD binding, the app first reads the
-- org's existing channel id (if any) and reuses it as p_channel_row_id; when the
-- org has no channel it passes a fresh UUID. A supplied id that belongs to a
-- DIFFERENT org is rejected (cross-tenant guard).
create or replace function public.connect_line_channel(
  target_org uuid,
  p_channel_row_id uuid,
  p_name text,
  p_channel_id text,
  p_basic_id text,
  p_liff_id text,
  p_secret_ciphertext bytea,
  p_secret_nonce bytea,
  p_access_token_ciphertext bytea,
  p_access_token_nonce bytea,
  p_key_version integer,
  p_token_expires_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_actor uuid := (select private.current_actor_user_id());
  v_channel_id uuid := p_channel_row_id;
  v_existing public.line_channels%rowtype;
begin
  if not public.has_org_role(target_org, array['owner', 'admin']::text[]) then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;

  select * into v_existing from public.line_channels where id = p_channel_row_id for update;
  if found then
    -- A channel with this id must belong to this org (cross-tenant guard).
    if v_existing.organization_id <> target_org then
      raise exception using errcode = 'P0002', message = 'LINE_CHANNEL_NOT_FOUND';
    end if;
    update public.line_channels
    set name = p_name,
        channel_id = p_channel_id,
        basic_id = p_basic_id,
        liff_id = p_liff_id,
        status = 'active',
        credential_version = p_key_version,
        last_error_code = null,
        updated_by = v_actor,
        lock_version = lock_version + 1
    where id = v_channel_id;
  else
    insert into public.line_channels (
      id, organization_id, name, channel_id, basic_id, liff_id, status,
      credential_version, created_by, updated_by
    ) values (
      p_channel_row_id, target_org, p_name, p_channel_id, p_basic_id, p_liff_id, 'active',
      p_key_version, v_actor, v_actor
    );
  end if;

  insert into private.line_channel_credentials (
    line_channel_id, organization_id, secret_ciphertext, secret_nonce,
    access_token_ciphertext, access_token_nonce, key_version, token_expires_at,
    rotated_at
  ) values (
    v_channel_id, target_org, p_secret_ciphertext, p_secret_nonce,
    p_access_token_ciphertext, p_access_token_nonce, p_key_version, p_token_expires_at,
    clock_timestamp()
  )
  on conflict (line_channel_id) do update
  set secret_ciphertext = excluded.secret_ciphertext,
      secret_nonce = excluded.secret_nonce,
      access_token_ciphertext = excluded.access_token_ciphertext,
      access_token_nonce = excluded.access_token_nonce,
      key_version = excluded.key_version,
      token_expires_at = excluded.token_expires_at,
      rotated_at = clock_timestamp(),
      updated_at = clock_timestamp();

  perform private.append_user_event(
    target_org, 'line_channel', v_channel_id, 'line_channel.connected',
    jsonb_build_object('channelId', p_channel_id, 'keyVersion', p_key_version),
    null, null, null
  );

  return jsonb_build_object('id', v_channel_id, 'status', 'active', 'credentialConfigured', true);
end;
$$;

alter function public.connect_line_channel(uuid, uuid, text, text, text, text, bytea, bytea, bytea, bytea, integer, timestamptz)
  owner to renoly_rls_owner;
revoke all on function public.connect_line_channel(uuid, uuid, text, text, text, text, bytea, bytea, bytea, bytea, integer, timestamptz)
  from public, anon, service_role;
grant execute on function public.connect_line_channel(uuid, uuid, text, text, text, text, bytea, bytea, bytea, bytea, integer, timestamptz)
  to authenticated;

------------------------------------------------------------------------------
-- public.rotate_line_channel_token — swap the encrypted access token only.
-- owner/admin only; If-Match enforced by the route via lock_version.
------------------------------------------------------------------------------
create or replace function public.rotate_line_channel_token(
  target_org uuid,
  p_channel_id uuid,
  p_access_token_ciphertext bytea,
  p_access_token_nonce bytea,
  p_key_version integer,
  p_token_expires_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_actor uuid := (select private.current_actor_user_id());
begin
  if not public.has_org_role(target_org, array['owner', 'admin']::text[]) then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;
  if not exists (
    select 1 from public.line_channels
    where organization_id = target_org and id = p_channel_id
  ) then
    raise exception using errcode = 'P0002', message = 'LINE_CHANNEL_NOT_FOUND';
  end if;

  update private.line_channel_credentials
  set access_token_ciphertext = p_access_token_ciphertext,
      access_token_nonce = p_access_token_nonce,
      key_version = p_key_version,
      token_expires_at = p_token_expires_at,
      rotated_at = clock_timestamp(),
      updated_at = clock_timestamp()
  where line_channel_id = p_channel_id and organization_id = target_org;
  if not found then
    raise exception using errcode = 'P0002', message = 'LINE_CHANNEL_NOT_FOUND';
  end if;

  update public.line_channels
  set credential_version = p_key_version,
      updated_by = v_actor,
      lock_version = lock_version + 1
  where organization_id = target_org and id = p_channel_id;

  perform private.append_user_event(
    target_org, 'line_channel', p_channel_id, 'line_channel.token_rotated',
    jsonb_build_object('keyVersion', p_key_version), null, null, null
  );

  return jsonb_build_object('id', p_channel_id, 'credentialConfigured', true);
end;
$$;

alter function public.rotate_line_channel_token(uuid, uuid, bytea, bytea, integer, timestamptz)
  owner to renoly_rls_owner;
revoke all on function public.rotate_line_channel_token(uuid, uuid, bytea, bytea, integer, timestamptz)
  from public, anon, service_role;
grant execute on function public.rotate_line_channel_token(uuid, uuid, bytea, bytea, integer, timestamptz)
  to authenticated;

------------------------------------------------------------------------------
-- public.verify_line_channel — mark the channel webhook-verified (staff clicks
-- "verify" after LINE sends a signed verify ping). owner/admin only.
------------------------------------------------------------------------------
create or replace function public.verify_line_channel(
  target_org uuid,
  p_channel_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_actor uuid := (select private.current_actor_user_id());
begin
  if not public.has_org_role(target_org, array['owner', 'admin']::text[]) then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;

  update public.line_channels
  set webhook_verified_at = clock_timestamp(),
      status = case when status = 'disabled' then status else 'active' end,
      updated_by = v_actor,
      lock_version = lock_version + 1
  where organization_id = target_org and id = p_channel_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'LINE_CHANNEL_NOT_FOUND';
  end if;

  return jsonb_build_object('id', p_channel_id, 'status', 'active');
end;
$$;

alter function public.verify_line_channel(uuid, uuid)
  owner to renoly_rls_owner;
revoke all on function public.verify_line_channel(uuid, uuid)
  from public, anon, service_role;
grant execute on function public.verify_line_channel(uuid, uuid)
  to authenticated;

------------------------------------------------------------------------------
-- public.list_line_channels / get_line_channel — REDACTED channel DTO. The only
-- credential signal is the credentialConfigured boolean (derived from the
-- private credentials row); ciphertext/nonce/keys are never selected. Read is
-- allowed for any active member; mutations remain owner/admin.
------------------------------------------------------------------------------
create or replace function public.list_line_channels(target_org uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_items jsonb;
begin
  if not public.has_org_role(
    target_org, array['owner', 'admin', 'dispatcher', 'technician', 'accountant', 'viewer']::text[]
  ) then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id,
    'name', c.name,
    'channelId', c.channel_id,
    'basicId', c.basic_id,
    'liffId', c.liff_id,
    'status', c.status,
    'credentialConfigured', exists (
      select 1 from private.line_channel_credentials cc where cc.line_channel_id = c.id
    ),
    'webhookVerifiedAt', c.webhook_verified_at,
    'lastWebhookAt', c.last_webhook_at,
    'lastErrorCode', c.last_error_code,
    'lockVersion', c.lock_version
  ) order by c.created_at, c.id), '[]'::jsonb)
  into v_items
  from public.line_channels c
  where c.organization_id = target_org;

  return jsonb_build_object('organizationId', target_org, 'items', v_items);
end;
$$;

alter function public.list_line_channels(uuid) owner to renoly_rls_owner;
revoke all on function public.list_line_channels(uuid) from public, anon, service_role;
grant execute on function public.list_line_channels(uuid) to authenticated;

create or replace function public.get_line_channel(target_org uuid, p_channel_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_row public.line_channels%rowtype;
begin
  if not public.has_org_role(
    target_org, array['owner', 'admin', 'dispatcher', 'technician', 'accountant', 'viewer']::text[]
  ) then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;

  select * into v_row
  from public.line_channels
  where organization_id = target_org and id = p_channel_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'LINE_CHANNEL_NOT_FOUND';
  end if;

  return jsonb_build_object(
    'id', v_row.id,
    'name', v_row.name,
    'channelId', v_row.channel_id,
    'basicId', v_row.basic_id,
    'liffId', v_row.liff_id,
    'status', v_row.status,
    'credentialConfigured', exists (
      select 1 from private.line_channel_credentials cc where cc.line_channel_id = v_row.id
    ),
    'webhookVerifiedAt', v_row.webhook_verified_at,
    'lastWebhookAt', v_row.last_webhook_at,
    'lastErrorCode', v_row.last_error_code,
    'lockVersion', v_row.lock_version
  );
end;
$$;

alter function public.get_line_channel(uuid, uuid) owner to renoly_rls_owner;
revoke all on function public.get_line_channel(uuid, uuid) from public, anon, service_role;
grant execute on function public.get_line_channel(uuid, uuid) to authenticated;

------------------------------------------------------------------------------
-- Rewired transition_work_order — enqueues 'completed' customer notification
-- on a normal (signoff) completion. Faithful copy of the 202607190006
-- definition + the completed-path enqueue; end-state grants reproduced so
-- create-or-replace does not re-expose the raw RPC to authenticated.
------------------------------------------------------------------------------
create or replace function public.transition_work_order(
  target_org uuid,
  target_work_order uuid,
  target_status text,
  expected_lock_version integer,
  target_occurred_at timestamptz,
  reason text default null,
  target_completion_summary text default null,
  target_correction_reason text default null,
  target_request_id uuid default null,
  target_idempotency_key text default null
)
returns public.work_orders
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  current_record public.work_orders%rowtype;
  result_record public.work_orders%rowtype;
  is_manager boolean;
  is_assigned boolean;
  v_notify jsonb := null;
begin
  if target_occurred_at is null then
    raise exception using errcode = '22023', message = 'OCCURRED_AT_REQUIRED';
  end if;
  if not isfinite(target_occurred_at) then
    raise exception using errcode = '22023', message = 'OCCURRED_AT_OUT_OF_RANGE';
  end if;
  if target_occurred_at > statement_timestamp() + interval '5 minutes'
     or target_occurred_at < statement_timestamp() - interval '30 days' then
    raise exception using errcode = '22023', message = 'OCCURRED_AT_OUT_OF_RANGE';
  end if;
  if target_occurred_at < statement_timestamp() - interval '24 hours' then
    if not public.has_org_role(target_org, array['owner', 'admin']::text[])
       or nullif(btrim(target_correction_reason), '') is null then
      raise exception using errcode = '22023', message = 'OCCURRED_AT_OUT_OF_RANGE';
    end if;
  end if;

  select * into current_record
  from public.work_orders
  where organization_id = target_org and id = target_work_order
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'WORK_ORDER_NOT_FOUND';
  end if;

  is_manager := public.has_org_role(target_org, array['owner', 'admin', 'dispatcher']::text[]);
  is_assigned := public.is_assigned_to_work_order(target_org, target_work_order);
  if not is_manager and not is_assigned then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;
  if current_record.lock_version is distinct from expected_lock_version then
    raise exception using errcode = '40001', message = 'STALE_VERSION';
  end if;

  if not (
    (current_record.status = 'draft' and target_status in ('scheduled', 'cancelled'))
    or (current_record.status = 'scheduled' and target_status in ('draft', 'dispatched', 'cancelled'))
    or (current_record.status = 'dispatched' and target_status in ('scheduled', 'en_route', 'cancelled'))
    or (current_record.status = 'en_route' and target_status in ('on_site', 'cancelled'))
    or (current_record.status = 'on_site' and target_status in ('paused', 'completed', 'cancelled'))
    or (current_record.status = 'paused' and target_status in ('on_site', 'completed', 'cancelled'))
    or (current_record.status = 'completed' and target_status = 'on_site')
  ) then
    raise exception using errcode = '23514', message = 'INVALID_WORK_ORDER_TRANSITION';
  end if;

  if target_status in ('scheduled', 'dispatched', 'cancelled', 'draft') and not is_manager then
    raise exception using errcode = '42501', message = 'WORK_ORDER_MANAGER_ACTION_REQUIRED';
  end if;
  if target_status in ('scheduled', 'dispatched') and (
    current_record.scheduled_start_at is null or current_record.scheduled_end_at is null
  ) then
    raise exception using errcode = '23514', message = 'SCHEDULE_REQUIRED';
  end if;
  if target_status in ('scheduled', 'dispatched', 'en_route') and not exists (
    select 1 from public.assignments a
    where a.organization_id = target_org
      and a.work_order_id = target_work_order
      and a.status in ('assigned', 'accepted', 'checked_in')
  ) then
    raise exception using errcode = '23514', message = 'ACTIVE_ASSIGNMENT_REQUIRED';
  end if;
  if target_status in ('cancelled', 'draft') and nullif(btrim(reason), '') is null then
    raise exception using errcode = '23514', message = 'TRANSITION_REASON_REQUIRED';
  end if;
  if current_record.status = 'completed' and target_status = 'on_site' then
    if not public.has_org_role(target_org, array['owner', 'admin']::text[])
       or current_record.completed_at < statement_timestamp() - interval '24 hours'
       or nullif(btrim(reason), '') is null then
      raise exception using errcode = '42501', message = 'REOPEN_NOT_ALLOWED';
    end if;
  end if;

  if target_status = 'completed' then
    if nullif(btrim(target_completion_summary), '') is null then
      raise exception using errcode = '23514', message = 'COMPLETION_SUMMARY_REQUIRED';
    end if;
    if exists (
      select 1
      from public.work_order_checklist_items ci
      where ci.organization_id = target_org
        and ci.work_order_id = target_work_order
        and ci.is_required
        and not private.checklist_item_answered(ci)
    ) then
      raise exception using errcode = '23514', message = 'REQUIRED_CHECKLIST_INCOMPLETE';
    end if;
    if exists (
      select 1
      from public.work_order_checklist_items ci
      where ci.organization_id = target_org
        and ci.work_order_id = target_work_order
        and ci.evidence_required
        and not exists (
          select 1 from public.photos p
          where p.organization_id = ci.organization_id
            and p.checklist_item_id = ci.id
            and p.status = 'ready'
            and p.deleted_at is null
        )
    ) then
      raise exception using errcode = '23514', message = 'REQUIRED_EVIDENCE_MISSING';
    end if;
    if not exists (
      select 1 from public.photos p
      where p.organization_id = target_org and p.work_order_id = target_work_order
        and p.category = 'before' and p.status = 'ready' and p.deleted_at is null
    ) or not exists (
      select 1 from public.photos p
      where p.organization_id = target_org and p.work_order_id = target_work_order
        and p.category = 'after' and p.status = 'ready' and p.deleted_at is null
    ) then
      raise exception using errcode = '23514', message = 'BEFORE_AFTER_PHOTOS_REQUIRED';
    end if;
    if current_record.requires_customer_signoff and current_record.customer_signed_at is null then
      raise exception using errcode = '23514', message = 'CUSTOMER_SIGNOFF_REQUIRED';
    end if;
  end if;

  update public.work_orders
  set status = target_status,
      scheduled_start_at = case when target_status = 'draft' then null else scheduled_start_at end,
      scheduled_end_at = case when target_status = 'draft' then null else scheduled_end_at end,
      dispatched_at = case when target_status = 'dispatched' then target_occurred_at else dispatched_at end,
      en_route_at = case when target_status = 'en_route' then target_occurred_at else en_route_at end,
      on_site_at = case when target_status = 'on_site' then target_occurred_at else on_site_at end,
      paused_at = case when target_status = 'paused' then target_occurred_at else paused_at end,
      completed_at = case
        when target_status = 'completed' then target_occurred_at
        when current_record.status = 'completed' and target_status = 'on_site' then null
        else completed_at
      end,
      cancelled_at = case when target_status = 'cancelled' then target_occurred_at else cancelled_at end,
      cancellation_reason = case when target_status = 'cancelled' then reason else cancellation_reason end,
      completion_summary = case
        when target_status = 'completed' then target_completion_summary
        when current_record.status = 'completed' and target_status = 'on_site' then null
        else work_orders.completion_summary
      end,
      updated_by = (select private.current_actor_user_id()),
      lock_version = lock_version + 1
  where organization_id = target_org and id = target_work_order
  returning * into result_record;

  if target_status = 'completed' and current_record.asset_id is not null then
    update public.assets
    set last_serviced_at = target_occurred_at,
        updated_by = (select private.current_actor_user_id()),
        lock_version = lock_version + 1
    where organization_id = target_org and id = current_record.asset_id;
  end if;

  -- A normal customer-signoff completion notifies the customer via the LINE
  -- outbox in THIS txn. Other transitions carry no customer notification.
  if target_status = 'completed' then
    v_notify := private.enqueue_customer_line_notification(
      target_org, current_record.customer_id, 'completed', 1,
      jsonb_build_object('workOrderNumber', current_record.work_order_no),
      'wo:' || target_work_order::text || ':completed',
      'work_order', target_work_order
    );
  end if;

  perform private.append_user_event(
    target_org, 'work_order', target_work_order,
    'work_order.' || target_status,
    jsonb_build_object(
      'from', current_record.status,
      'to', target_status,
      'reason', reason,
      'correctionReason', target_correction_reason,
      'notification', v_notify
    ),
    target_request_id, target_idempotency_key, target_occurred_at
  );
  return result_record;
end;
$$;

-- Privilege end-state note: the original definition (202607160003) granted
-- execute to authenticated, but 202607160004_v2_phase1_hardening then REVOKED it
-- so only the validated wrapper public.transition_work_order_safe is reachable by
-- request-path callers; the raw RPC is invoked solely by that security-definer
-- wrapper (running as owner). We reproduce that authoritative end-state here --
-- revoke from public AND authenticated, no re-grant -- so `create or replace`
-- does not re-expose the raw transition RPC (asserted by
-- 00_schema_and_privileges test "raw work-order transition RPC is not exposed").
alter function public.transition_work_order(uuid, uuid, text, integer, timestamptz, text, text, text, uuid, text)
  owner to renoly_rls_owner;
revoke all on function public.transition_work_order(uuid, uuid, text, integer, timestamptz, text, text, text, uuid, text)
  from public, authenticated;

------------------------------------------------------------------------------
-- public.get_line_channel_secret_material — service_role ONLY. Returns the
-- ENCRYPTED credential material for a channel (ciphertext/nonce/keyVersion, hex),
-- so the webhook route + dispatch worker can decrypt just-in-time in Node. The
-- private schema is NOT exposed via PostgREST, so this security-definer RPC is the
-- only path the admin (service_role) client has to that row. It returns ciphertext
-- ONLY — never plaintext — and is unreachable by anon/authenticated.
------------------------------------------------------------------------------
create or replace function public.get_line_channel_secret_material(p_channel_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_org uuid;
  v_cred private.line_channel_credentials%rowtype;
begin
  select organization_id into v_org from public.line_channels where id = p_channel_id;
  if v_org is null then
    raise exception using errcode = 'P0002', message = 'LINE_CHANNEL_NOT_FOUND';
  end if;

  select * into v_cred from private.line_channel_credentials where line_channel_id = p_channel_id;
  if not found then
    return jsonb_build_object('organizationId', v_org, 'credentialConfigured', false);
  end if;

  return jsonb_build_object(
    'organizationId', v_org,
    'credentialConfigured', true,
    'keyVersion', v_cred.key_version,
    'secretCiphertext', encode(v_cred.secret_ciphertext, 'hex'),
    'secretNonce', encode(v_cred.secret_nonce, 'hex'),
    'accessTokenCiphertext', encode(v_cred.access_token_ciphertext, 'hex'),
    'accessTokenNonce', encode(v_cred.access_token_nonce, 'hex')
  );
end;
$$;

alter function public.get_line_channel_secret_material(uuid) owner to renoly_rls_owner;
revoke all on function public.get_line_channel_secret_material(uuid)
  from public, anon, authenticated;
grant execute on function public.get_line_channel_secret_material(uuid) to service_role;
