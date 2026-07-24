-- Renoly v2 M5: dispatch, technician tasks, checklists, photos and completion.
--
-- This migration adds the operational RPC surface for M5 without touching the
-- authoritative work-order completion gate (public.transition_work_order) or
-- relaxing any existing RLS policy. Force-complete is a SEPARATE function so the
-- pinned gate stays pure; it emits a distinct `work_order.force_completed` event
-- and NEVER sets customer_signed_at.
--
-- Conventions reused from M0-M4:
--   * security definer, set search_path, owner renoly_rls_owner
--   * revoke all from public, grant execute to authenticated
--   * private.append_user_event for the append-only chain
--   * lock_version optimistic concurrency, has_org_role / is_assigned_to_work_order
--   * next_document_number for work-order numbering
--   * private.pilot intake photo verify-and-mark-ready pattern for photos
--
-- Error contract (SQLSTATE -> app HTTP mapping is done in the route error mapper):
--   42501 FORBIDDEN / *_REQUIRES_MANAGER          -> 403
--   P0002 *_NOT_FOUND                              -> 404
--   40001 STALE_VERSION                            -> 412
--   23514 *_REQUIRED / INVALID_* / *_INCOMPLETE    -> 422
--   22023 *_INVALID / OCCURRED_AT_*                -> 422
--   23505 *_ALREADY_*                              -> 409
--   'RENSC' SCHEDULE_CONFLICT (custom SQLSTATE)    -> 409 + conflicts[]

set search_path = pg_catalog, public, private;

------------------------------------------------------------------------------
-- Shared helper: resolve the caller's active membership id in an org.
------------------------------------------------------------------------------

create or replace function private.current_membership_id(target_org uuid)
returns uuid
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select m.id
  from public.memberships m
  where m.organization_id = target_org
    and m.user_id = (select private.current_actor_user_id())
    and m.status = 'active'
  limit 1;
$$;

alter function private.current_membership_id(uuid) owner to renoly_rls_owner;
revoke all on function private.current_membership_id(uuid) from public, anon, authenticated;

------------------------------------------------------------------------------
-- Shared projection: build a role/assignment-scoped work-order detail JSON.
-- Technician callers never receive internal_notes; work_orders itself carries
-- no cost columns (cost lives in technician-blocked quote tables), so trimming
-- internal-only notes plus scoping assignments/checklists/photos to this work
-- order is sufficient. Managers get the full projection.
------------------------------------------------------------------------------

create or replace function private.work_order_detail_json(
  target_org uuid,
  target_work_order uuid,
  include_internal boolean
)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, private
as $$
  select jsonb_build_object(
    'id', wo.id,
    'organizationId', wo.organization_id,
    'workOrderNo', wo.work_order_no,
    'projectId', wo.project_id,
    'serviceRequestId', wo.service_request_id,
    'customerId', wo.customer_id,
    'locationId', wo.location_id,
    'assetId', wo.asset_id,
    'title', wo.title,
    'description', wo.description,
    'customerNotes', wo.customer_notes,
    'technicianNotes', wo.technician_notes,
    'internalNotes', case when include_internal then wo.internal_notes else null end,
    'completionSummary', wo.completion_summary,
    'priority', wo.priority,
    'status', wo.status,
    'scheduledStartAt', wo.scheduled_start_at,
    'scheduledEndAt', wo.scheduled_end_at,
    'dispatchedAt', wo.dispatched_at,
    'enRouteAt', wo.en_route_at,
    'onSiteAt', wo.on_site_at,
    'pausedAt', wo.paused_at,
    'completedAt', wo.completed_at,
    'cancelledAt', wo.cancelled_at,
    'cancellationReason', wo.cancellation_reason,
    'requiresCustomerSignoff', wo.requires_customer_signoff,
    'customerSignedAt', wo.customer_signed_at,
    'lockVersion', wo.lock_version,
    'createdAt', wo.created_at,
    'updatedAt', wo.updated_at,
    'assignments', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', a.id,
          'membershipId', a.membership_id,
          'memberName', m.display_name,
          'duty', a.duty,
          'status', a.status,
          'assignedAt', a.assigned_at,
          'acceptedAt', a.accepted_at,
          'declinedAt', a.declined_at,
          'checkedInAt', a.checked_in_at,
          'completedAt', a.completed_at,
          'cancelledAt', a.cancelled_at,
          'declineReason', a.decline_reason,
          'lockVersion', a.lock_version
        ) order by a.assigned_at, a.id
      )
      from public.assignments a
      join public.memberships m
        on m.organization_id = a.organization_id and m.id = a.membership_id
      where a.organization_id = target_org and a.work_order_id = target_work_order
    ), '[]'::jsonb),
    'checklists', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', wc.id,
          'name', wc.name,
          'status', wc.status,
          'completedAt', wc.completed_at,
          'completedByMembershipId', wc.completed_by_membership_id,
          'lockVersion', wc.lock_version,
          'items', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', ci.id,
                'label', ci.label,
                'responseType', ci.response_type,
                'isRequired', ci.is_required,
                'evidenceRequired', ci.evidence_required,
                'options', ci.options,
                'response', ci.response,
                'completedAt', ci.completed_at,
                'completedByMembershipId', ci.completed_by_membership_id,
                'sortOrder', ci.sort_order
              ) order by ci.sort_order, ci.id
            )
            from public.work_order_checklist_items ci
            where ci.organization_id = target_org
              and ci.work_order_checklist_id = wc.id
          ), '[]'::jsonb)
        ) order by wc.created_at, wc.id
      )
      from public.work_order_checklists wc
      where wc.organization_id = target_org and wc.work_order_id = target_work_order
    ), '[]'::jsonb),
    'photos', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', p.id,
          'category', p.category,
          'status', p.status,
          'checklistItemId', p.checklist_item_id,
          'storagePath', p.storage_path,
          'mimeType', p.mime_type,
          'byteSize', p.byte_size,
          'width', p.width,
          'height', p.height,
          'sha256', p.sha256,
          'caption', p.caption,
          'capturedAt', p.captured_at,
          'uploadedByMembershipId', p.uploaded_by_membership_id,
          'readyAt', p.ready_at,
          'lockVersion', p.lock_version,
          'createdAt', p.created_at
        ) order by p.created_at, p.id
      )
      from public.photos p
      where p.organization_id = target_org
        and p.work_order_id = target_work_order
        and p.deleted_at is null
    ), '[]'::jsonb)
  )
  from public.work_orders wo
  where wo.organization_id = target_org and wo.id = target_work_order;
$$;

alter function private.work_order_detail_json(uuid, uuid, boolean) owner to renoly_rls_owner;
revoke all on function private.work_order_detail_json(uuid, uuid, boolean) from public, anon, authenticated;

------------------------------------------------------------------------------
-- create_work_order: dispatcher-created work order (non-convert path).
------------------------------------------------------------------------------

create or replace function public.create_work_order(
  target_org uuid,
  p_payload jsonb,
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
  v_work_order_id uuid := gen_random_uuid();
  v_customer uuid;
  v_location uuid;
  v_period text;
  v_sequence bigint;
  v_work_order_no text;
  v_actor_fingerprint text;
  v_request_hash text;
  v_idempotency public.idempotency_keys%rowtype;
  v_inserted integer;
begin
  if not public.has_org_role(target_org, array['owner', 'admin', 'dispatcher']::text[]) then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;
  if nullif(btrim(p_idempotency_key), '') is null
     or char_length(p_idempotency_key) not between 8 and 128
     or p_payload is null
     or jsonb_typeof(p_payload) <> 'object'
     or not (p_payload ?& array['customerId', 'locationId', 'title'])
     or nullif(btrim(p_payload ->> 'title'), '') is null
     or char_length(p_payload ->> 'title') > 160
     or exists (
       select 1 from jsonb_object_keys(p_payload) key
       where key <> all(array[
         'customerId', 'locationId', 'projectId', 'assetId', 'serviceRequestId',
         'serviceCatalogItemId', 'title', 'description', 'customerNotes',
         'internalNotes', 'priority'
       ])
     )
     or coalesce(p_payload ->> 'priority', 'normal') not in ('low', 'normal', 'high', 'urgent') then
    raise exception using errcode = '22023', message = 'WORK_ORDER_PAYLOAD_INVALID';
  end if;

  v_customer := (p_payload ->> 'customerId')::uuid;
  v_location := (p_payload ->> 'locationId')::uuid;

  v_actor_fingerprint := 'work-order-create:' || v_actor::text;
  v_request_hash := encode(extensions.digest(
    target_org::text || '|' || p_payload::text, 'sha256'
  ), 'hex');

  insert into public.idempotency_keys (
    organization_id, actor_fingerprint, method, path_template,
    idempotency_key, request_hash, state, locked_until, expires_at
  ) values (
    target_org, v_actor_fingerprint, 'POST',
    '/api/v2/organizations/{orgId}/work-orders', p_idempotency_key,
    v_request_hash, 'processing', clock_timestamp() + interval '2 minutes',
    clock_timestamp() + interval '24 hours'
  )
  on conflict (actor_fingerprint, method, path_template, idempotency_key) do nothing
  returning * into v_idempotency;
  get diagnostics v_inserted = row_count;

  if v_inserted = 0 then
    select * into v_idempotency
    from public.idempotency_keys
    where actor_fingerprint = v_actor_fingerprint
      and method = 'POST'
      and path_template = '/api/v2/organizations/{orgId}/work-orders'
      and idempotency_key = p_idempotency_key
    for update;
    if v_idempotency.request_hash is distinct from v_request_hash then
      raise exception using errcode = '22023', message = 'IDEMPOTENCY_CONFLICT';
    end if;
    if v_idempotency.state = 'completed' and v_idempotency.resource_id is not null then
      return private.work_order_detail_json(target_org, v_idempotency.resource_id, true)
        || jsonb_build_object('replayed', true);
    end if;
    raise exception using errcode = '22023', message = 'IDEMPOTENCY_IN_PROGRESS';
  end if;

  -- Location must belong to the customer (composite FK enforces it too, but we
  -- surface a friendly binding error instead of a raw constraint violation).
  if not exists (
    select 1 from public.locations l
    where l.organization_id = target_org and l.id = v_location and l.customer_id = v_customer
  ) then
    raise exception using errcode = '23503', message = 'WORK_ORDER_BINDING_MISMATCH';
  end if;

  select to_char(statement_timestamp() at time zone o.timezone, 'YYYYMM')
  into v_period
  from public.organizations o where o.id = target_org;

  v_sequence := public.next_document_number(target_org, 'work_order', v_period);
  v_work_order_no := 'W-' || v_period || '-' || lpad(v_sequence::text, 6, '0');

  insert into public.work_orders (
    id, organization_id, work_order_no, project_id, service_request_id,
    customer_id, location_id, asset_id, service_catalog_item_id, title,
    description, customer_notes, internal_notes, priority, status,
    created_by, updated_by
  ) values (
    v_work_order_id, target_org, v_work_order_no,
    nullif(p_payload ->> 'projectId', '')::uuid,
    nullif(p_payload ->> 'serviceRequestId', '')::uuid,
    v_customer, v_location,
    nullif(p_payload ->> 'assetId', '')::uuid,
    nullif(p_payload ->> 'serviceCatalogItemId', '')::uuid,
    p_payload ->> 'title',
    coalesce(p_payload ->> 'description', ''),
    coalesce(p_payload ->> 'customerNotes', ''),
    coalesce(p_payload ->> 'internalNotes', ''),
    coalesce(p_payload ->> 'priority', 'normal'),
    'draft', v_actor, v_actor
  );

  perform private.append_user_event(
    target_org, 'work_order', v_work_order_id, 'work_order.created',
    jsonb_build_object('workOrderNo', v_work_order_no, 'status', 'draft'),
    p_request_id, p_idempotency_key
  );

  update public.idempotency_keys
  set state = 'completed', resource_type = 'work_order', resource_id = v_work_order_id,
      response_status = 201, updated_at = statement_timestamp()
  where id = v_idempotency.id;

  return private.work_order_detail_json(target_org, v_work_order_id, true);
end;
$$;

alter function public.create_work_order(uuid, jsonb, text, uuid) owner to renoly_rls_owner;
revoke all on function public.create_work_order(uuid, jsonb, text, uuid) from public, anon, service_role;
grant execute on function public.create_work_order(uuid, jsonb, text, uuid) to authenticated;

------------------------------------------------------------------------------
-- check_schedule_conflicts: overlap query for candidate windows/members.
-- Returns { conflicts: [ { membershipId, workOrderId, workOrderNo,
-- startsAt, endsAt } ] } for the supplied members over a window, excluding an
-- optional work order (the one being scheduled).
------------------------------------------------------------------------------

create or replace function public.check_schedule_conflicts(
  target_org uuid,
  p_membership_ids uuid[],
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_exclude_work_order uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_conflicts jsonb;
begin
  if not public.has_org_role(target_org, array['owner', 'admin', 'dispatcher']::text[]) then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;
  if p_membership_ids is null or array_length(p_membership_ids, 1) is null
     or array_length(p_membership_ids, 1) > 50
     or p_starts_at is null or p_ends_at is null
     or not isfinite(p_starts_at) or not isfinite(p_ends_at)
     or p_ends_at <= p_starts_at then
    raise exception using errcode = '22023', message = 'SCHEDULE_CONFLICT_QUERY_INVALID';
  end if;

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
    and a.membership_id = any(p_membership_ids)
    and a.status in ('assigned', 'accepted', 'checked_in')
    and wo.status not in ('draft', 'completed', 'cancelled')
    and wo.scheduled_start_at is not null
    and wo.scheduled_end_at is not null
    and (p_exclude_work_order is null or wo.id <> p_exclude_work_order)
    and wo.scheduled_start_at < p_ends_at
    and wo.scheduled_end_at > p_starts_at;

  return jsonb_build_object('conflicts', v_conflicts);
end;
$$;

alter function public.check_schedule_conflicts(uuid, uuid[], timestamptz, timestamptz, uuid) owner to renoly_rls_owner;
revoke all on function public.check_schedule_conflicts(uuid, uuid[], timestamptz, timestamptz, uuid) from public, anon, service_role;
grant execute on function public.check_schedule_conflicts(uuid, uuid[], timestamptz, timestamptz, uuid) to authenticated;

------------------------------------------------------------------------------
-- Shared assignment projection (technician-safe: no cost, single work order).
------------------------------------------------------------------------------

create or replace function private.assignment_json(a public.assignments)
returns jsonb
language sql
immutable
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'id', a.id,
    'organizationId', a.organization_id,
    'workOrderId', a.work_order_id,
    'membershipId', a.membership_id,
    'duty', a.duty,
    'status', a.status,
    'assignedAt', a.assigned_at,
    'acceptedAt', a.accepted_at,
    'declinedAt', a.declined_at,
    'checkedInAt', a.checked_in_at,
    'completedAt', a.completed_at,
    'cancelledAt', a.cancelled_at,
    'declineReason', a.decline_reason,
    'lockVersion', a.lock_version
  );
$$;

alter function private.assignment_json(public.assignments) owner to renoly_rls_owner;
revoke all on function private.assignment_json(public.assignments) from public, anon, authenticated;

------------------------------------------------------------------------------
-- create_assignment: assign a member to a work order.
------------------------------------------------------------------------------

create or replace function public.create_assignment(
  target_org uuid,
  target_work_order uuid,
  p_membership_id uuid,
  p_duty text,
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
  v_assignment_id uuid := gen_random_uuid();
  v_work public.work_orders%rowtype;
  v_actor_fingerprint text;
  v_request_hash text;
  v_idempotency public.idempotency_keys%rowtype;
  v_inserted integer;
  v_result public.assignments%rowtype;
begin
  if not public.has_org_role(target_org, array['owner', 'admin', 'dispatcher']::text[]) then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;
  if p_duty is null or p_duty not in ('lead', 'technician', 'helper', 'observer')
     or nullif(btrim(p_idempotency_key), '') is null
     or char_length(p_idempotency_key) not between 8 and 128 then
    raise exception using errcode = '22023', message = 'ASSIGNMENT_PAYLOAD_INVALID';
  end if;

  select * into v_work
  from public.work_orders
  where organization_id = target_org and id = target_work_order;
  if not found then
    raise exception using errcode = 'P0002', message = 'WORK_ORDER_NOT_FOUND';
  end if;
  if v_work.status in ('completed', 'cancelled') then
    raise exception using errcode = '23514', message = 'WORK_ORDER_NOT_ASSIGNABLE';
  end if;
  if (select count(*) from public.assignments a
      where a.organization_id = target_org and a.work_order_id = target_work_order
        and a.status not in ('declined', 'cancelled')) >= 20 then
    raise exception using errcode = '23514', message = 'ASSIGNMENT_LIMIT_EXCEEDED';
  end if;

  v_actor_fingerprint := 'assignment-create:' || v_actor::text;
  v_request_hash := encode(extensions.digest(
    target_org::text || '|' || target_work_order::text || '|'
    || p_membership_id::text || '|' || p_duty, 'sha256'
  ), 'hex');

  insert into public.idempotency_keys (
    organization_id, actor_fingerprint, method, path_template,
    idempotency_key, request_hash, state, locked_until, expires_at
  ) values (
    target_org, v_actor_fingerprint, 'POST',
    '/api/v2/organizations/{orgId}/work-orders/{id}/assignments', p_idempotency_key,
    v_request_hash, 'processing', clock_timestamp() + interval '2 minutes',
    clock_timestamp() + interval '24 hours'
  )
  on conflict (actor_fingerprint, method, path_template, idempotency_key) do nothing
  returning * into v_idempotency;
  get diagnostics v_inserted = row_count;

  if v_inserted = 0 then
    select * into v_idempotency
    from public.idempotency_keys
    where actor_fingerprint = v_actor_fingerprint
      and method = 'POST'
      and path_template = '/api/v2/organizations/{orgId}/work-orders/{id}/assignments'
      and idempotency_key = p_idempotency_key
    for update;
    if v_idempotency.request_hash is distinct from v_request_hash then
      raise exception using errcode = '22023', message = 'IDEMPOTENCY_CONFLICT';
    end if;
    if v_idempotency.state = 'completed' and v_idempotency.resource_id is not null then
      select * into v_result from public.assignments
      where organization_id = target_org and id = v_idempotency.resource_id;
      return private.assignment_json(v_result) || jsonb_build_object('replayed', true);
    end if;
    raise exception using errcode = '22023', message = 'IDEMPOTENCY_IN_PROGRESS';
  end if;

  -- validate_assignment_member trigger rejects inactive/ineligible members;
  -- assignments_work_order_member_uidx rejects duplicate assignment; the partial
  -- one-active-lead index rejects a second active lead.
  insert into public.assignments (
    id, organization_id, work_order_id, membership_id, duty, status,
    assigned_by, created_by, updated_by
  ) values (
    v_assignment_id, target_org, target_work_order, p_membership_id, p_duty,
    'assigned', v_actor, v_actor, v_actor
  )
  returning * into v_result;

  perform private.append_user_event(
    target_org, 'work_order', target_work_order, 'assignment.created',
    jsonb_build_object(
      'assignmentId', v_assignment_id, 'membershipId', p_membership_id, 'duty', p_duty
    ),
    p_request_id, p_idempotency_key
  );

  update public.idempotency_keys
  set state = 'completed', resource_type = 'assignment', resource_id = v_assignment_id,
      response_status = 201, updated_at = statement_timestamp()
  where id = v_idempotency.id;

  return private.assignment_json(v_result);
end;
$$;

alter function public.create_assignment(uuid, uuid, uuid, text, text, uuid) owner to renoly_rls_owner;
revoke all on function public.create_assignment(uuid, uuid, uuid, text, text, uuid) from public, anon, service_role;
grant execute on function public.create_assignment(uuid, uuid, uuid, text, text, uuid) to authenticated;

------------------------------------------------------------------------------
-- update_assignment: change duty on an existing assignment (manager, If-Match).
------------------------------------------------------------------------------

create or replace function public.update_assignment(
  target_org uuid,
  target_assignment uuid,
  p_duty text,
  p_expected_lock_version integer,
  p_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_actor uuid := (select private.current_actor_user_id());
  v_current public.assignments%rowtype;
  v_result public.assignments%rowtype;
begin
  if not public.has_org_role(target_org, array['owner', 'admin', 'dispatcher']::text[]) then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;
  if p_duty is null or p_duty not in ('lead', 'technician', 'helper', 'observer') then
    raise exception using errcode = '22023', message = 'ASSIGNMENT_PAYLOAD_INVALID';
  end if;

  select * into v_current
  from public.assignments
  where organization_id = target_org and id = target_assignment
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'ASSIGNMENT_NOT_FOUND';
  end if;
  if v_current.lock_version is distinct from p_expected_lock_version then
    raise exception using errcode = '40001', message = 'STALE_VERSION';
  end if;
  if v_current.status in ('declined', 'cancelled') then
    raise exception using errcode = '23514', message = 'ASSIGNMENT_NOT_EDITABLE';
  end if;

  update public.assignments
  set duty = p_duty,
      updated_by = v_actor,
      lock_version = lock_version + 1
  where organization_id = target_org and id = target_assignment
  returning * into v_result;

  perform private.append_user_event(
    target_org, 'work_order', v_current.work_order_id, 'assignment.updated',
    jsonb_build_object(
      'assignmentId', target_assignment, 'membershipId', v_current.membership_id,
      'fromDuty', v_current.duty, 'toDuty', p_duty
    ),
    p_request_id, null
  );

  return private.assignment_json(v_result);
end;
$$;

alter function public.update_assignment(uuid, uuid, text, integer, uuid) owner to renoly_rls_owner;
revoke all on function public.update_assignment(uuid, uuid, text, integer, uuid) from public, anon, service_role;
grant execute on function public.update_assignment(uuid, uuid, text, integer, uuid) to authenticated;

------------------------------------------------------------------------------
-- cancel_assignment: soft-cancel (-> cancelled) via the authoritative
-- transition_assignment mutator, then return the technician-safe DTO.
------------------------------------------------------------------------------

create or replace function public.cancel_assignment(
  target_org uuid,
  target_assignment uuid,
  p_reason text,
  p_expected_lock_version integer,
  p_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_result public.assignments%rowtype;
begin
  if nullif(btrim(p_reason), '') is null then
    raise exception using errcode = '23514', message = 'ASSIGNMENT_CANCEL_REASON_REQUIRED';
  end if;
  -- transition_assignment enforces manager gate, optimistic lock and the
  -- assigned/accepted/checked_in -> cancelled legality, and appends the event.
  v_result := public.transition_assignment(
    target_org, target_assignment, 'cancelled', p_expected_lock_version,
    p_reason, p_request_id, null
  );
  return private.assignment_json(v_result);
end;
$$;

alter function public.cancel_assignment(uuid, uuid, text, integer, uuid) owner to renoly_rls_owner;
revoke all on function public.cancel_assignment(uuid, uuid, text, integer, uuid) from public, anon, service_role;
grant execute on function public.cancel_assignment(uuid, uuid, text, integer, uuid) to authenticated;

------------------------------------------------------------------------------
-- respond_to_assignment: technician self accept/decline via transition_assignment
-- (which already gates self-membership). Decline requires a reason.
------------------------------------------------------------------------------

create or replace function public.respond_to_assignment(
  target_org uuid,
  target_assignment uuid,
  p_decision text,
  p_reason text,
  p_expected_lock_version integer,
  p_idempotency_key text default null,
  p_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_status text;
  v_result public.assignments%rowtype;
begin
  if p_decision is null or p_decision not in ('accept', 'decline') then
    raise exception using errcode = '22023', message = 'ASSIGNMENT_RESPONSE_INVALID';
  end if;
  v_status := case when p_decision = 'accept' then 'accepted' else 'declined' end;

  v_result := public.transition_assignment(
    target_org, target_assignment, v_status, p_expected_lock_version,
    case when p_decision = 'decline' then p_reason else null end,
    p_request_id, p_idempotency_key
  );
  return private.assignment_json(v_result);
end;
$$;

alter function public.respond_to_assignment(uuid, uuid, text, text, integer, text, uuid) owner to renoly_rls_owner;
revoke all on function public.respond_to_assignment(uuid, uuid, text, text, integer, text, uuid) from public, anon, service_role;
grant execute on function public.respond_to_assignment(uuid, uuid, text, text, integer, text, uuid) to authenticated;

------------------------------------------------------------------------------
-- schedule_work_order: atomic schedule + (re)assign + transition draft->scheduled
-- in a single transaction. Conflict detection blocks plain dispatchers; owner/
-- admin may override with a reason.
--
-- p_assignments: jsonb array of { membershipId, duty }.
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

  perform private.append_user_event(
    target_org, 'work_order', target_work_order, 'work_order.scheduled_dispatch',
    jsonb_build_object(
      'scheduledStartAt', p_scheduled_start_at,
      'scheduledEndAt', p_scheduled_end_at,
      'assignmentCount', jsonb_array_length(p_assignments),
      'conflictOverride', jsonb_array_length(v_conflicts) > 0,
      'notification', jsonb_build_object('status', 'not_sent', 'reason', 'line_delivery_deferred_to_m6')
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
-- list_work_orders: keyset projection. Technicians see ONLY work orders they are
-- assigned to. Managers see the whole org filtered by the supplied predicates.
-- Cursor is (scheduled_start_at nulls last, id) descending-stable via a synthetic
-- sort key; we keyset on (created_at, id) desc for determinism.
------------------------------------------------------------------------------

create or replace function public.list_work_orders(
  target_org uuid,
  p_filters jsonb default '{}'::jsonb,
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null,
  p_page_size integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_is_manager boolean;
  v_membership uuid;
  v_items jsonb;
  v_status text := nullif(p_filters ->> 'status', '');
  v_assignee uuid := nullif(p_filters ->> 'assigneeId', '')::uuid;
  v_project uuid := nullif(p_filters ->> 'projectId', '')::uuid;
  v_customer uuid := nullif(p_filters ->> 'customerId', '')::uuid;
  v_asset uuid := nullif(p_filters ->> 'assetId', '')::uuid;
  v_priority text := nullif(p_filters ->> 'priority', '');
  v_from timestamptz := nullif(p_filters ->> 'scheduledFrom', '')::timestamptz;
  v_to timestamptz := nullif(p_filters ->> 'scheduledTo', '')::timestamptz;
  v_q text := nullif(btrim(p_filters ->> 'q'), '');
begin
  if not public.is_active_member(target_org) then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;
  if p_page_size is null or p_page_size not between 1 and 100 then
    raise exception using errcode = '22023', message = 'LIST_PAGE_SIZE_INVALID';
  end if;

  v_is_manager := public.has_org_role(
    target_org, array['owner', 'admin', 'dispatcher', 'accountant', 'viewer']::text[]
  );
  v_membership := private.current_membership_id(target_org);

  select coalesce(jsonb_agg(row_value order by created_at desc, id desc), '[]'::jsonb)
  into v_items
  from (
    select
      wo.id, wo.created_at,
      jsonb_build_object(
        'id', wo.id,
        'workOrderNo', wo.work_order_no,
        'title', wo.title,
        'status', wo.status,
        'priority', wo.priority,
        'customerId', wo.customer_id,
        'projectId', wo.project_id,
        'assetId', wo.asset_id,
        'scheduledStartAt', wo.scheduled_start_at,
        'scheduledEndAt', wo.scheduled_end_at,
        'completedAt', wo.completed_at,
        'lockVersion', wo.lock_version,
        'createdAt', wo.created_at,
        'updatedAt', wo.updated_at,
        'assigneeCount', (
          select count(*)::integer from public.assignments a
          where a.organization_id = wo.organization_id and a.work_order_id = wo.id
            and a.status in ('assigned', 'accepted', 'checked_in')
        )
      ) as row_value
    from public.work_orders wo
    where wo.organization_id = target_org
      -- Technician sees only own assignments.
      and (
        v_is_manager
        or exists (
          select 1 from public.assignments a
          where a.organization_id = wo.organization_id and a.work_order_id = wo.id
            and a.membership_id = v_membership
            and a.status in ('assigned', 'accepted', 'checked_in')
        )
      )
      and (v_status is null or wo.status = v_status)
      and (v_priority is null or wo.priority = v_priority)
      and (v_project is null or wo.project_id = v_project)
      and (v_customer is null or wo.customer_id = v_customer)
      and (v_asset is null or wo.asset_id = v_asset)
      and (v_from is null or wo.scheduled_start_at >= v_from)
      and (v_to is null or wo.scheduled_start_at < v_to)
      and (v_assignee is null or exists (
        select 1 from public.assignments a
        where a.organization_id = wo.organization_id and a.work_order_id = wo.id
          and a.membership_id = v_assignee
          and a.status in ('assigned', 'accepted', 'checked_in')
      ))
      and (v_q is null or wo.title ilike '%' || v_q || '%' or wo.work_order_no ilike '%' || v_q || '%')
      and (
        p_cursor_created_at is null or p_cursor_id is null
        or (wo.created_at, wo.id) < (p_cursor_created_at, p_cursor_id)
      )
    order by wo.created_at desc, wo.id desc
    limit p_page_size
  ) rows;

  return jsonb_build_object('organizationId', target_org, 'items', v_items);
end;
$$;

alter function public.list_work_orders(uuid, jsonb, timestamptz, uuid, integer) owner to renoly_rls_owner;
revoke all on function public.list_work_orders(uuid, jsonb, timestamptz, uuid, integer) from public, anon, service_role;
grant execute on function public.list_work_orders(uuid, jsonb, timestamptz, uuid, integer) to authenticated;

------------------------------------------------------------------------------
-- get_work_order_detail: role/assignment-scoped detail. Technicians (assigned,
-- non-manager) receive a projection WITHOUT internal_notes. Managers get all.
------------------------------------------------------------------------------

create or replace function public.get_work_order_detail(
  target_org uuid,
  target_work_order uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_is_manager boolean;
  v_is_assigned boolean;
begin
  if not exists (
    select 1 from public.work_orders
    where organization_id = target_org and id = target_work_order
  ) then
    -- Uniform 404 to avoid tenant existence leakage.
    raise exception using errcode = 'P0002', message = 'WORK_ORDER_NOT_FOUND';
  end if;

  v_is_manager := public.has_org_role(
    target_org, array['owner', 'admin', 'dispatcher', 'accountant', 'viewer']::text[]
  );
  v_is_assigned := public.is_assigned_to_work_order(target_org, target_work_order);
  if not v_is_manager and not v_is_assigned then
    raise exception using errcode = 'P0002', message = 'WORK_ORDER_NOT_FOUND';
  end if;

  return private.work_order_detail_json(target_org, target_work_order, v_is_manager);
end;
$$;

alter function public.get_work_order_detail(uuid, uuid) owner to renoly_rls_owner;
revoke all on function public.get_work_order_detail(uuid, uuid) from public, anon, service_role;
grant execute on function public.get_work_order_detail(uuid, uuid) to authenticated;

------------------------------------------------------------------------------
-- create_work_order_checklist: inline checklist (items <= 200), snapshot-frozen
-- once the parent is completed/cancelled by the existing guard trigger.
--
-- p_items: jsonb array of { label, responseType, isRequired, evidenceRequired,
-- options }.
------------------------------------------------------------------------------

create or replace function public.create_work_order_checklist(
  target_org uuid,
  target_work_order uuid,
  p_name text,
  p_items jsonb,
  p_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_actor uuid := (select private.current_actor_user_id());
  v_checklist_id uuid := gen_random_uuid();
  v_item jsonb;
  v_sort integer := 0;
begin
  if not public.has_org_role(target_org, array['owner', 'admin', 'dispatcher']::text[]) then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;
  if nullif(btrim(p_name), '') is null or char_length(p_name) > 120
     or p_items is null or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 200 then
    raise exception using errcode = '22023', message = 'CHECKLIST_PAYLOAD_INVALID';
  end if;

  if not exists (
    select 1 from public.work_orders
    where organization_id = target_org and id = target_work_order
      and status not in ('completed', 'cancelled')
  ) then
    raise exception using errcode = '23514', message = 'WORK_ORDER_NOT_EDITABLE';
  end if;

  insert into public.work_order_checklists (
    id, organization_id, work_order_id, name, status, created_by, updated_by
  ) values (
    v_checklist_id, target_org, target_work_order, p_name, 'pending', v_actor, v_actor
  );

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    if jsonb_typeof(v_item) <> 'object'
       or nullif(btrim(v_item ->> 'label'), '') is null
       or char_length(v_item ->> 'label') > 300
       or coalesce(v_item ->> 'responseType', '') not in
          ('boolean', 'text', 'number', 'single_choice', 'multi_choice', 'photo') then
      raise exception using errcode = '22023', message = 'CHECKLIST_ITEM_INVALID';
    end if;
    v_sort := v_sort + 1;
    insert into public.work_order_checklist_items (
      organization_id, work_order_checklist_id, work_order_id, label, response_type,
      is_required, evidence_required, options, sort_order
    ) values (
      target_org, v_checklist_id, target_work_order, v_item ->> 'label',
      v_item ->> 'responseType',
      coalesce((v_item ->> 'isRequired')::boolean, false),
      coalesce((v_item ->> 'evidenceRequired')::boolean, false),
      coalesce(v_item -> 'options', '[]'::jsonb),
      v_sort
    );
  end loop;

  perform private.append_user_event(
    target_org, 'work_order', target_work_order, 'checklist.created',
    jsonb_build_object('checklistId', v_checklist_id, 'name', p_name, 'itemCount', jsonb_array_length(p_items)),
    p_request_id, null
  );

  return jsonb_build_object('checklistId', v_checklist_id, 'workOrderId', target_work_order, 'name', p_name);
end;
$$;

alter function public.create_work_order_checklist(uuid, uuid, text, jsonb, uuid) owner to renoly_rls_owner;
revoke all on function public.create_work_order_checklist(uuid, uuid, text, jsonb, uuid) from public, anon, service_role;
grant execute on function public.create_work_order_checklist(uuid, uuid, text, jsonb, uuid) to authenticated;

------------------------------------------------------------------------------
-- complete_work_order_checklist: mark one checklist completed. Requires every
-- required item answered and every evidence-required item to have a ready photo.
-- If-Match is on the parent work order aggregate; the checklist gets its own lock.
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
      and ci.is_required and ci.response is null
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
-- force_complete_work_order: owner/admin-only exception completion. Skips the
-- required-checklist / evidence / before-after gate but demands a reason. Writes
-- a DISTINCT `work_order.force_completed` event and NEVER sets customer_signed_at.
-- Deliberately a separate function so transition_work_order's gate stays pinned.
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
        and ci.is_required and ci.response is null
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

------------------------------------------------------------------------------
-- complete_work_order_photo: verify-and-mark-ready. The app layer downloads the
-- object, computes real MIME (magic bytes), byte size, sha256 and dimensions,
-- and passes them here; this RPC cross-checks the declared values and flips
-- pending -> ready. Only the uploader or a manager may complete.
------------------------------------------------------------------------------

create or replace function public.complete_work_order_photo(
  target_org uuid,
  target_photo uuid,
  p_actual_mime_type text,
  p_actual_byte_size bigint,
  p_actual_sha256 text,
  p_image_width integer,
  p_image_height integer,
  p_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_actor uuid := (select private.current_actor_user_id());
  v_photo public.photos%rowtype;
  v_membership uuid;
begin
  if p_actual_mime_type not in ('image/jpeg', 'image/png', 'image/webp')
     or p_actual_byte_size is null or p_actual_byte_size not between 1 and 10485760
     or p_actual_sha256 is null or p_actual_sha256 !~ '^[0-9A-Fa-f]{64}$'
     or p_image_width is null or p_image_width not between 1 and 10000
     or p_image_height is null or p_image_height not between 1 and 10000
     or p_image_width::bigint * p_image_height::bigint > 25000000 then
    raise exception using errcode = '22023', message = 'PHOTO_VERIFICATION_INVALID';
  end if;

  select * into v_photo
  from public.photos
  where organization_id = target_org and id = target_photo
    and work_order_id is not null
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'PHOTO_NOT_FOUND';
  end if;

  v_membership := private.current_membership_id(target_org);
  if not public.has_org_role(target_org, array['owner', 'admin', 'dispatcher']::text[])
     and v_photo.uploaded_by_membership_id is distinct from v_membership then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;
  if v_photo.deleted_at is not null then
    raise exception using errcode = '23514', message = 'PHOTO_DELETED';
  end if;
  if v_photo.status = 'ready' then
    -- Idempotent replay: declared already matches ready state.
    if v_photo.sha256 = lower(p_actual_sha256) then
      return jsonb_build_object(
        'photoId', v_photo.id, 'status', 'ready', 'readyAt', v_photo.ready_at,
        'replayed', true
      );
    end if;
    raise exception using errcode = '23514', message = 'PHOTO_ALREADY_READY';
  end if;
  if v_photo.status <> 'pending' then
    raise exception using errcode = '23514', message = 'PHOTO_NOT_PENDING';
  end if;

  -- Declared-vs-actual cross-check (the declared values were pinned at upload).
  if v_photo.mime_type is distinct from p_actual_mime_type
     or v_photo.byte_size is distinct from p_actual_byte_size
     or v_photo.sha256 is distinct from lower(p_actual_sha256) then
    raise exception using errcode = '42501', message = 'PHOTO_VERIFICATION_MISMATCH';
  end if;

  update public.photos
  set status = 'ready',
      width = p_image_width,
      height = p_image_height,
      ready_at = clock_timestamp(),
      updated_by = v_actor,
      lock_version = lock_version + 1
  where organization_id = target_org and id = target_photo
  returning * into v_photo;

  perform private.append_user_event(
    target_org, 'work_order', v_photo.work_order_id, 'photo.ready',
    jsonb_build_object(
      'photoId', v_photo.id, 'category', v_photo.category,
      'checklistItemId', v_photo.checklist_item_id
    ),
    p_request_id, null
  );

  return jsonb_build_object(
    'photoId', v_photo.id,
    'status', v_photo.status,
    'category', v_photo.category,
    'byteSize', v_photo.byte_size,
    'width', v_photo.width,
    'height', v_photo.height,
    'readyAt', v_photo.ready_at,
    'lockVersion', v_photo.lock_version
  );
end;
$$;

alter function public.complete_work_order_photo(uuid, uuid, text, bigint, text, integer, integer, uuid)
  owner to renoly_rls_owner;
revoke all on function public.complete_work_order_photo(uuid, uuid, text, bigint, text, integer, integer, uuid)
  from public, anon, service_role;
grant execute on function public.complete_work_order_photo(uuid, uuid, text, bigint, text, integer, integer, uuid)
  to authenticated;

------------------------------------------------------------------------------
-- get_work_order_photo_read_url: authorize a caller to read a photo, returning
-- the storage path and a TTL. The Node signer mints the actual signed URL with
-- the admin client; this RPC is the authorization gate and never logs URLs.
------------------------------------------------------------------------------

create or replace function public.get_work_order_photo_read_url(
  target_org uuid,
  target_photo uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_photo public.photos%rowtype;
begin
  select * into v_photo
  from public.photos
  where organization_id = target_org and id = target_photo
    and work_order_id is not null and deleted_at is null;
  if not found then
    raise exception using errcode = 'P0002', message = 'PHOTO_NOT_FOUND';
  end if;

  if not public.has_org_role(
       target_org, array['owner', 'admin', 'dispatcher', 'accountant', 'viewer']::text[]
     )
     and not public.is_assigned_to_work_order(target_org, v_photo.work_order_id) then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;

  return jsonb_build_object(
    'photoId', v_photo.id,
    'storagePath', v_photo.storage_path,
    'mimeType', v_photo.mime_type,
    'expiresInSeconds', 300
  );
end;
$$;

alter function public.get_work_order_photo_read_url(uuid, uuid) owner to renoly_rls_owner;
revoke all on function public.get_work_order_photo_read_url(uuid, uuid) from public, anon, service_role;
grant execute on function public.get_work_order_photo_read_url(uuid, uuid) to authenticated;

------------------------------------------------------------------------------
-- update_work_order_photo: caption/category PATCH (If-Match on the photo row).
------------------------------------------------------------------------------

create or replace function public.update_work_order_photo(
  target_org uuid,
  target_photo uuid,
  p_caption text,
  p_category text,
  p_expected_lock_version integer,
  p_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_actor uuid := (select private.current_actor_user_id());
  v_photo public.photos%rowtype;
  v_membership uuid;
begin
  if p_category is not null
     and p_category not in ('intake', 'before', 'after', 'issue', 'receipt', 'signature', 'other') then
    raise exception using errcode = '22023', message = 'PHOTO_UPDATE_INVALID';
  end if;
  if p_caption is not null and char_length(p_caption) > 1000 then
    raise exception using errcode = '22023', message = 'PHOTO_UPDATE_INVALID';
  end if;

  select * into v_photo
  from public.photos
  where organization_id = target_org and id = target_photo
    and work_order_id is not null and deleted_at is null
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'PHOTO_NOT_FOUND';
  end if;

  v_membership := private.current_membership_id(target_org);
  if not public.has_org_role(target_org, array['owner', 'admin', 'dispatcher']::text[])
     and v_photo.uploaded_by_membership_id is distinct from v_membership then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;
  if v_photo.lock_version is distinct from p_expected_lock_version then
    raise exception using errcode = '40001', message = 'STALE_VERSION';
  end if;

  update public.photos
  set caption = coalesce(p_caption, caption),
      category = coalesce(p_category, category),
      updated_by = v_actor,
      lock_version = lock_version + 1
  where organization_id = target_org and id = target_photo
  returning * into v_photo;

  perform private.append_user_event(
    target_org, 'work_order', v_photo.work_order_id, 'photo.updated',
    jsonb_build_object('photoId', v_photo.id, 'category', v_photo.category),
    p_request_id, null
  );

  return jsonb_build_object(
    'photoId', v_photo.id,
    'caption', v_photo.caption,
    'category', v_photo.category,
    'lockVersion', v_photo.lock_version
  );
end;
$$;

alter function public.update_work_order_photo(uuid, uuid, text, text, integer, uuid) owner to renoly_rls_owner;
revoke all on function public.update_work_order_photo(uuid, uuid, text, text, integer, uuid) from public, anon, service_role;
grant execute on function public.update_work_order_photo(uuid, uuid, text, text, integer, uuid) to authenticated;

------------------------------------------------------------------------------
-- delete_work_order_photo: soft delete (set deleted_at). Refuses to delete a
-- photo that is currently serving as completion evidence (before/after ready or
-- an evidence-required checklist item's only ready photo).
------------------------------------------------------------------------------

create or replace function public.delete_work_order_photo(
  target_org uuid,
  target_photo uuid,
  p_expected_lock_version integer,
  p_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_actor uuid := (select private.current_actor_user_id());
  v_photo public.photos%rowtype;
  v_membership uuid;
begin
  select * into v_photo
  from public.photos
  where organization_id = target_org and id = target_photo
    and work_order_id is not null and deleted_at is null
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'PHOTO_NOT_FOUND';
  end if;

  v_membership := private.current_membership_id(target_org);
  if not public.has_org_role(target_org, array['owner', 'admin', 'dispatcher']::text[])
     and v_photo.uploaded_by_membership_id is distinct from v_membership then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;
  if v_photo.lock_version is distinct from p_expected_lock_version then
    raise exception using errcode = '40001', message = 'STALE_VERSION';
  end if;

  -- Block deletion when this ready photo is the sole evidence for a required
  -- checklist item. before/after are guarded at completion time; here we protect
  -- an evidence-required item's last remaining proof.
  if v_photo.status = 'ready' and v_photo.checklist_item_id is not null and exists (
    select 1 from public.work_order_checklist_items ci
    where ci.organization_id = target_org and ci.id = v_photo.checklist_item_id
      and ci.evidence_required
  ) and not exists (
    select 1 from public.photos other
    where other.organization_id = target_org
      and other.checklist_item_id = v_photo.checklist_item_id
      and other.id <> v_photo.id
      and other.status = 'ready' and other.deleted_at is null
  ) then
    raise exception using errcode = '23514', message = 'PHOTO_IS_COMPLETION_EVIDENCE';
  end if;

  update public.photos
  set status = 'deleted',
      deleted_at = statement_timestamp(),
      updated_by = v_actor,
      lock_version = lock_version + 1
  where organization_id = target_org and id = target_photo;

  perform private.append_user_event(
    target_org, 'work_order', v_photo.work_order_id, 'photo.deleted',
    jsonb_build_object('photoId', v_photo.id, 'category', v_photo.category),
    p_request_id, null
  );

  return jsonb_build_object('photoId', v_photo.id, 'status', 'deleted');
end;
$$;

alter function public.delete_work_order_photo(uuid, uuid, integer, uuid) owner to renoly_rls_owner;
revoke all on function public.delete_work_order_photo(uuid, uuid, integer, uuid) from public, anon, service_role;
grant execute on function public.delete_work_order_photo(uuid, uuid, integer, uuid) to authenticated;

------------------------------------------------------------------------------
-- respond_to_checklist_item event wiring: the existing M0-M4 RPC recorded the
-- response but did NOT append an event. Re-create it to append a
-- `checklist_item.responded` event so the timeline can reconstruct field input.
-- Signature and behaviour are otherwise identical (drop-in replacement).
------------------------------------------------------------------------------

create or replace function public.respond_to_checklist_item(
  target_org uuid,
  target_item uuid,
  response_value jsonb,
  expected_work_order_lock_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  item_record public.work_order_checklist_items%rowtype;
  work_record public.work_orders%rowtype;
  actor_membership uuid;
begin
  select * into item_record
  from public.work_order_checklist_items
  where organization_id = target_org and id = target_item
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'CHECKLIST_ITEM_NOT_FOUND';
  end if;

  select * into work_record
  from public.work_orders
  where organization_id = target_org and id = item_record.work_order_id
  for update;

  if work_record.lock_version is distinct from expected_work_order_lock_version then
    raise exception using errcode = '40001', message = 'STALE_VERSION';
  end if;
  if work_record.status not in ('on_site', 'paused') then
    raise exception using errcode = '23514', message = 'WORK_ORDER_NOT_EDITABLE_ON_SITE';
  end if;
  if not public.has_org_role(target_org, array['owner', 'admin', 'dispatcher']::text[])
     and not public.is_assigned_to_work_order(target_org, item_record.work_order_id) then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;

  select m.id into actor_membership
  from public.memberships m
  where m.organization_id = target_org
    and m.user_id = (select private.current_actor_user_id())
    and m.status = 'active';

  if response_value is null or response_value = 'null'::jsonb then
    raise exception using errcode = '22023', message = 'CHECKLIST_RESPONSE_REQUIRED';
  end if;
  if (item_record.response_type = 'boolean' and jsonb_typeof(response_value) <> 'boolean')
     or (item_record.response_type = 'text' and jsonb_typeof(response_value) <> 'string')
     or (item_record.response_type = 'number' and jsonb_typeof(response_value) <> 'number')
     or (item_record.response_type = 'single_choice' and jsonb_typeof(response_value) <> 'string')
     or (item_record.response_type in ('multi_choice', 'photo') and jsonb_typeof(response_value) <> 'array') then
    raise exception using errcode = '22023', message = 'CHECKLIST_RESPONSE_TYPE_INVALID';
  end if;

  update public.work_order_checklist_items
  set response = response_value,
      completed_at = statement_timestamp(),
      completed_by_membership_id = actor_membership
  where organization_id = target_org and id = target_item;

  perform private.append_user_event(
    target_org, 'work_order', item_record.work_order_id, 'checklist_item.responded',
    jsonb_build_object(
      'checklistItemId', target_item,
      'checklistId', item_record.work_order_checklist_id,
      'responseType', item_record.response_type
    ),
    null, null
  );

  return jsonb_build_object(
    'id', target_item,
    'workOrderId', item_record.work_order_id,
    'response', response_value,
    'completedAt', statement_timestamp(),
    'lockVersion', work_record.lock_version
  );
end;
$$;

alter function public.respond_to_checklist_item(uuid, uuid, jsonb, integer)
  owner to renoly_rls_owner;
revoke all on function public.respond_to_checklist_item(uuid, uuid, jsonb, integer) from public, anon, service_role;
grant execute on function public.respond_to_checklist_item(uuid, uuid, jsonb, integer) to authenticated;
