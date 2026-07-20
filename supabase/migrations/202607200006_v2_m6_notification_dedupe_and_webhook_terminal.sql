-- Renoly v2 M6 — two correctness fixes for the LINE notification/webhook plumbing.
--
-- FIX 1 (HIGH) — reopen/reschedule silently dropped the customer notification.
--   The enqueue dedupe_key had no version discriminator:
--     schedule_work_order       -> 'wo:ID:appointment_confirmed'
--     transition_work_order      -> 'wo:ID:completed'   (signoff completion)
--     force_complete_work_order  -> 'wo:ID:completed'   (owner override)
--   notifications_dedupe_uidx is a PERMANENT unique on (org, channel, dedupe_key),
--   so once a work order was completed (or scheduled) once, a legitimate
--   RE-notification after reopen->recomplete or reschedule collided with the first
--   outbox row and ON CONFLICT DO NOTHING dropped it — the customer was never told
--   about the re-scheduled appointment or the second completion.
--
--   Fix: append the NEW work_order lock_version to the key. A reopen/reschedule
--   bumps lock_version, so the recomplete/reschedule gets a distinct key and
--   enqueues a fresh outbox row; a genuine same-transaction idempotent replay
--   (identical lock_version) still collapses to a single row. New key formats:
--     'wo:ID:appointment_confirmed:v{new_lock_version}'
--     'wo:ID:completed:v{new_lock_version}'
--   We CREATE OR REPLACE the three RPCs reproducing their CURRENT bodies VERBATIM
--   (from 202607200005), changing ONLY the dedupe_key argument, and re-emit the
--   authoritative owner/grants for each.
--
-- FIX 2 (medium) — the webhook inbox had no terminal state / no watchdog. A
--   permanently-failing event kept being re-claimed and re-failed, bumping
--   attempt_count on every pass until the (0..100) CHECK finally threw. We mirror
--   the notification outbox terminal semantics:
--     * add line_webhook_events.max_attempts (default 25) + failed_at,
--     * private.mark_webhook_terminal makes a failed event terminal once
--       attempt_count reaches max_attempts (status stays 'failed',
--       next_attempt_at = null, failed_at stamped) so it is no longer re-claimed,
--     * claim_line_webhook_events skips rows at/past the ceiling,
--     * public.requeue_stale_line_webhook_events mirrors
--       requeue_stale_notifications for processing rows stuck past the threshold.

set search_path = pg_catalog, public, private, extensions;

------------------------------------------------------------------------------
-- FIX 2 schema: max-attempts ceiling column + terminal timestamp for the inbox.
-- Both are additive and nullable/defaulted so no backfill semantics change; the
-- attempt_count (0..100) CHECK stays as the hard upper bound, 25 is the soft
-- terminal ceiling the worker now honours before we ever reach it.
------------------------------------------------------------------------------
alter table public.line_webhook_events
  add column if not exists max_attempts smallint not null default 25,
  add column if not exists failed_at timestamptz;

------------------------------------------------------------------------------
-- FIX 1: schedule_work_order — dedupe_key now carries the new lock_version.
-- Body reproduced VERBATIM from 202607200005; ONLY the dedupe_key changed.
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
  -- The dedupe_key carries the NEW lock_version so a reschedule (draft->reschedule
  -- bumps lock_version) enqueues a fresh row instead of colliding with the prior
  -- appointment_confirmed on the permanent (org,channel,dedupe_key) unique.
  v_notify := private.enqueue_customer_line_notification(
    target_org, v_work.customer_id, 'appointment_confirmed', 1,
    jsonb_build_object('workOrderNumber', v_work.work_order_no),
    'wo:' || target_work_order::text || ':appointment_confirmed:v' || v_count::text,
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
-- FIX 1: force_complete_work_order — dedupe_key now carries the new lock_version.
-- Body reproduced VERBATIM from 202607200005; ONLY the dedupe_key changed.
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

  -- Enqueue the customer completed LINE notification in THIS txn. The dedupe_key
  -- carries the NEW lock_version (v_work.lock_version + 1) so a reopen->recomplete
  -- enqueues a fresh row instead of colliding with the first completion.
  v_notify := private.enqueue_customer_line_notification(
    target_org, v_work.customer_id, 'completed', 1,
    jsonb_build_object('workOrderNumber', v_work.work_order_no),
    'wo:' || target_work_order::text || ':completed:v' || (v_work.lock_version + 1)::text,
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
-- FIX 1: transition_work_order — dedupe_key now carries the new lock_version.
-- Body reproduced VERBATIM from 202607200005; ONLY the dedupe_key changed.
-- Privilege end-state reproduced (revoke from public AND authenticated, no
-- re-grant) so create-or-replace does not re-expose the raw transition RPC.
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
  -- outbox in THIS txn. Other transitions carry no customer notification. The
  -- dedupe_key carries the NEW lock_version so a reopen->recomplete enqueues a
  -- fresh row instead of colliding with the first completion.
  if target_status = 'completed' then
    v_notify := private.enqueue_customer_line_notification(
      target_org, current_record.customer_id, 'completed', 1,
      jsonb_build_object('workOrderNumber', current_record.work_order_no),
      'wo:' || target_work_order::text || ':completed:v' || result_record.lock_version::text,
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

alter function public.transition_work_order(uuid, uuid, text, integer, timestamptz, text, text, text, uuid, text)
  owner to renoly_rls_owner;
revoke all on function public.transition_work_order(uuid, uuid, text, integer, timestamptz, text, text, text, uuid, text)
  from public, authenticated;

------------------------------------------------------------------------------
-- FIX 2: private.mark_webhook_terminal — a failed event becomes terminal once
-- attempt_count reaches max_attempts (status stays 'failed', next_attempt_at
-- null, failed_at stamped) so the claim query never re-hands it to a worker. A
-- failure BELOW the ceiling still schedules a full-jitter backoff (re-queueable).
-- processed/ignored keep their existing terminal semantics.
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
  v_exhausted boolean;
begin
  select * into v_row from public.line_webhook_events where id = p_event_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'WEBHOOK_EVENT_NOT_FOUND';
  end if;
  if v_row.status <> 'processing' then
    raise exception using errcode = 'P0001', message = 'WEBHOOK_NOT_PROCESSING';
  end if;

  v_attempt := (v_row.attempt_count + 1)::smallint;
  v_exhausted := v_attempt >= v_row.max_attempts;
  if p_status = 'failed' and not v_exhausted then
    v_next := clock_timestamp() + private.notification_backoff_delay(v_attempt::integer);
  end if;

  update public.line_webhook_events
  set status = p_status,
      processed_at = case when p_status in ('processed', 'ignored') then clock_timestamp() else processed_at end,
      attempt_count = v_attempt,
      next_attempt_at = case when p_status = 'failed' and not v_exhausted then v_next else null end,
      failed_at = case when p_status = 'failed' and v_exhausted then clock_timestamp() else failed_at end,
      locked_at = null,
      error_code = case when p_status = 'failed' then p_note else null end
  where id = p_event_id;

  return jsonb_build_object(
    'id', p_event_id, 'status', p_status,
    'attemptCount', v_attempt, 'terminal', p_status <> 'failed' or v_exhausted
  );
end;
$$;

alter function private.mark_webhook_terminal(uuid, text, text) owner to renoly_rls_owner;
revoke all on function private.mark_webhook_terminal(uuid, text, text)
  from public, anon, authenticated, service_role;

------------------------------------------------------------------------------
-- FIX 2: claim_line_webhook_events — same claim shape, plus a ceiling guard so a
-- row whose attempt_count has reached max_attempts is never re-claimed (mirrors
-- the notifications claim's attempt_count < max_attempts predicate).
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
      and w.attempt_count < w.max_attempts
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
-- FIX 2: public.requeue_stale_line_webhook_events — inbox watchdog. Mirrors
-- public.requeue_stale_notifications: processing rows whose locked_at is older
-- than p_threshold_minutes return to 'pending' with their lock cleared and
-- next_attempt_at set to now so the worker re-claims them. service_role only.
------------------------------------------------------------------------------
create or replace function public.requeue_stale_line_webhook_events(
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
    select id from public.line_webhook_events
    where status = 'processing'
      and locked_at is not null
      and locked_at <= v_now - (v_threshold || ' minutes')::interval
    for update skip locked
  )
  update public.line_webhook_events w
  set status = 'pending',
      locked_at = null,
      next_attempt_at = v_now
  from stale s
  where w.id = s.id;
  get diagnostics v_count = row_count;

  return jsonb_build_object('requeued', v_count);
end;
$$;

alter function public.requeue_stale_line_webhook_events(timestamptz, integer) owner to renoly_rls_owner;
revoke all on function public.requeue_stale_line_webhook_events(timestamptz, integer) from public, anon, authenticated;
grant execute on function public.requeue_stale_line_webhook_events(timestamptz, integer) to service_role;
