-- Renoly v2 M5: make photo-type required checklist items satisfiable at the DB.
--
-- BUG being fixed: the completion gate treated any required checklist item as
-- incomplete whenever `response IS NULL`, regardless of response_type. A
-- response_type='photo' item has no textual response -- its answer is the
-- uploaded photo -- so it stayed NULL forever and blocked normal completion
-- (only owner force-complete escaped). The client now writes a photo response
-- best-effort, but that is not authoritative; the DB must be the source of truth.
--
-- NEW RULE (authoritative, DB layer): a required item blocks completion when
-- unanswered, EXCEPT a response_type='photo' item counts as answered once it has
-- >=1 linked photo with status='ready' AND deleted_at IS NULL
-- (public.photos where checklist_item_id = item.id). Text/number/boolean/choice
-- items are unchanged (still need a non-null response).
--
-- This migration:
--   * Adds private.checklist_item_answered(work_order_checklist_items) implementing
--     the rule.
--   * Re-creates the three predicate sites (transition_work_order,
--     complete_work_order_checklist, force_complete_work_order) VERBATIM, swapping
--     ONLY the required-incomplete predicate to use the new helper. No other gate,
--     message, event, lock, or logic changes. The work_orders status constraint is
--     untouched.
--
-- Error contract is unchanged (REQUIRED_CHECKLIST_INCOMPLETE / 23514).

set search_path = pg_catalog, public, private;

------------------------------------------------------------------------------
-- private.checklist_item_answered: the authoritative "is this required item
-- answered?" rule. A non-null response is always answered. A photo-type item is
-- answered once it has at least one ready, non-deleted linked photo. Every other
-- response_type needs a non-null response.
------------------------------------------------------------------------------

create or replace function private.checklist_item_answered(
  p_item public.work_order_checklist_items
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, private
as $$
  select case
    when p_item.response is not null then true
    when p_item.response_type = 'photo' then exists (
      select 1 from public.photos p
      where p.organization_id = p_item.organization_id
        and p.checklist_item_id = p_item.id
        and p.status = 'ready'
        and p.deleted_at is null
    )
    else false
  end;
$$;

alter function private.checklist_item_answered(public.work_order_checklist_items)
  owner to renoly_rls_owner;
revoke all on function private.checklist_item_answered(public.work_order_checklist_items)
  from public, anon, authenticated, service_role;

------------------------------------------------------------------------------
-- Site 1: public.transition_work_order. Verbatim reproduction of the current
-- body (202607160003_v2_security_and_rpcs.sql), swapping ONLY the
-- REQUIRED_CHECKLIST_INCOMPLETE predicate to private.checklist_item_answered(ci).
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

  perform private.append_user_event(
    target_org, 'work_order', target_work_order,
    'work_order.' || target_status,
    jsonb_build_object(
      'from', current_record.status,
      'to', target_status,
      'reason', reason,
      'correctionReason', target_correction_reason
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
-- Site 2: public.complete_work_order_checklist. Verbatim reproduction of the
-- current body (202607190004_v2_m5_work_order_ops.sql), swapping ONLY the
-- per-checklist REQUIRED_CHECKLIST_INCOMPLETE predicate.
------------------------------------------------------------------------------

create or replace function public.complete_work_order_checklist(
  target_org uuid,
  target_checklist uuid,
  p_expected_work_order_lock_version integer,
  p_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_actor uuid := (select private.current_actor_user_id());
  v_checklist public.work_order_checklists%rowtype;
  v_work public.work_orders%rowtype;
  v_membership uuid;
begin
  select * into v_checklist
  from public.work_order_checklists
  where organization_id = target_org and id = target_checklist
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'CHECKLIST_NOT_FOUND';
  end if;

  select * into v_work
  from public.work_orders
  where organization_id = target_org and id = v_checklist.work_order_id
  for update;

  if not public.has_org_role(target_org, array['owner', 'admin', 'dispatcher']::text[])
     and not public.is_assigned_to_work_order(target_org, v_checklist.work_order_id) then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;
  if v_work.lock_version is distinct from p_expected_work_order_lock_version then
    raise exception using errcode = '40001', message = 'STALE_VERSION';
  end if;
  if v_work.status not in ('on_site', 'paused') then
    raise exception using errcode = '23514', message = 'WORK_ORDER_NOT_EDITABLE_ON_SITE';
  end if;
  if v_checklist.status = 'completed' then
    raise exception using errcode = '23505', message = 'CHECKLIST_ALREADY_COMPLETED';
  end if;

  if exists (
    select 1 from public.work_order_checklist_items ci
    where ci.organization_id = target_org
      and ci.work_order_checklist_id = target_checklist
      and ci.is_required and not private.checklist_item_answered(ci)
  ) then
    raise exception using errcode = '23514', message = 'REQUIRED_CHECKLIST_INCOMPLETE';
  end if;
  if exists (
    select 1 from public.work_order_checklist_items ci
    where ci.organization_id = target_org
      and ci.work_order_checklist_id = target_checklist
      and ci.evidence_required
      and not exists (
        select 1 from public.photos p
        where p.organization_id = ci.organization_id
          and p.checklist_item_id = ci.id
          and p.status = 'ready' and p.deleted_at is null
      )
  ) then
    raise exception using errcode = '23514', message = 'REQUIRED_EVIDENCE_MISSING';
  end if;

  v_membership := private.current_membership_id(target_org);

  update public.work_order_checklists
  set status = 'completed',
      completed_at = statement_timestamp(),
      completed_by_membership_id = v_membership,
      updated_by = v_actor,
      lock_version = lock_version + 1
  where organization_id = target_org and id = target_checklist;

  perform private.append_user_event(
    target_org, 'work_order', v_checklist.work_order_id, 'checklist.completed',
    jsonb_build_object('checklistId', target_checklist, 'name', v_checklist.name),
    p_request_id, null
  );

  return jsonb_build_object(
    'checklistId', target_checklist,
    'workOrderId', v_checklist.work_order_id,
    'status', 'completed',
    'completedAt', statement_timestamp()
  );
end;
$$;

alter function public.complete_work_order_checklist(uuid, uuid, integer, uuid) owner to renoly_rls_owner;
revoke all on function public.complete_work_order_checklist(uuid, uuid, integer, uuid) from public, anon, service_role;
grant execute on function public.complete_work_order_checklist(uuid, uuid, integer, uuid) to authenticated;

------------------------------------------------------------------------------
-- Site 3: public.force_complete_work_order. Verbatim reproduction of the current
-- body (202607190004_v2_m5_work_order_ops.sql), swapping ONLY the
-- 'requiredChecklistIncomplete' exists()-subquery in the bypassed-gates audit
-- snapshot so it reports true only when a truly-unanswered required item remains.
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

  perform private.append_user_event(
    target_org, 'work_order', target_work_order, 'work_order.force_completed',
    jsonb_build_object(
      'from', v_work.status,
      'to', 'completed',
      'overrideReason', p_reason,
      'bypassedGates', v_missing,
      'customerSignoff', false,
      'notification', jsonb_build_object('status', 'not_sent', 'reason', 'line_delivery_deferred_to_m6')
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
