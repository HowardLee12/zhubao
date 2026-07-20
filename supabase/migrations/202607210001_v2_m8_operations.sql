-- Renoly v2 M8 (Wave A) — payment tracking, asset history, maintenance/revisit,
-- and the basic KPI dashboard, all built on the payment_milestones /
-- maintenance_plans / assets tables shipped in the M1 schema.
--
-- This migration is additive. Schema changes:
--   1. events_aggregate_type_chk gains 'asset' (DROP + ADD, mirroring how M3/M7
--      added customer/conversation/intake_draft) so asset history can hash-chain
--      against the events log rather than a separate asset_events table.
--   2. service_requests.source gains 'revisit' and two origin-linkage columns
--      (origin_maintenance_plan_id composite FK + origin_service_request_id) so a
--      one-click revisit conversion carries provenance and KPI 4 can count it.
--   3. private.enqueue_customer_line_notification gains a p_approval_status
--      overload (default 'not_required' keeps M6 callers compatible; revisit
--      reminders pass 'pending' so claim_notifications holds them until a human
--      approves).
--
-- Everything else is SECURITY DEFINER RPCs owned by renoly_rls_owner following
-- the schedule_work_order pattern: has_org_role gate -> SELECT ... FOR UPDATE ->
-- lock_version vs p_expected_lock_version (STALE_VERSION 40001) -> status
-- precondition -> in-txn append_user_event / append_system_event (+ enqueue).
--
-- HARD RULES enforced here:
--   * amounts are integer minor units; amount_minor > 0 by table constraint and
--     reverse never rewrites the amount.
--   * timestamps stored UTC; overdue and next_due_on are computed against the
--     org's timezone (Asia/Taipei default) via `(ts at time zone org.timezone)`.
--   * technician projection DTOs NEVER carry cost/amount/margin/KPI fields.
--   * mark-paid is TRACKING ONLY: it never calls a gateway and rejects (422 +
--     a contentless security event) if card/CVV/bank-secret-looking fields appear.
--   * human-confirm gates: reverse requires a reason; a revisit reminder is
--     enqueued approval_status='pending' and only sends after staff approval.

set search_path = pg_catalog, public, private, extensions;

------------------------------------------------------------------------------
-- 1. Schema: events allowlist gains 'asset'.
------------------------------------------------------------------------------

alter table public.events drop constraint events_aggregate_type_chk;
alter table public.events add constraint events_aggregate_type_chk check (
  aggregate_type in (
    'customer', 'conversation', 'intake_draft', 'service_request', 'project',
    'work_order', 'quote', 'change_order', 'payment_milestone',
    'maintenance_plan', 'line_channel', 'asset'
  )
);

------------------------------------------------------------------------------
-- 2. Schema: service_requests revisit source + origin linkage.
--    NOTE: additive enum widen (see ADR-0007). origin_maintenance_plan_id uses a
--    composite FK to keep tenant isolation; origin_service_request_id references
--    the same table within the tenant scope.
------------------------------------------------------------------------------

alter table public.service_requests drop constraint service_requests_source_chk;
alter table public.service_requests add constraint service_requests_source_chk
  check (source in ('line', 'phone', 'web', 'referral', 'manual', 'revisit'));

alter table public.service_requests
  add column origin_maintenance_plan_id uuid,
  add column origin_service_request_id uuid;

alter table public.service_requests
  add constraint service_requests_origin_plan_fk
    foreign key (organization_id, origin_maintenance_plan_id)
    references public.maintenance_plans (organization_id, id) on delete set null,
  add constraint service_requests_origin_request_fk
    foreign key (organization_id, origin_service_request_id)
    references public.service_requests (organization_id, id) on delete set null,
  add constraint service_requests_revisit_origin_chk check (
    source <> 'revisit' or origin_maintenance_plan_id is not null
      or origin_service_request_id is not null
  );

create index service_requests_origin_plan_idx
  on public.service_requests (organization_id, origin_maintenance_plan_id, created_at, id)
  where origin_maintenance_plan_id is not null;

------------------------------------------------------------------------------
-- 3. private.enqueue_customer_line_notification — approval-status overload.
--    Distinct arity from the M6 8-arg helper so both coexist; the 9-arg form
--    defaults p_approval_status to 'not_required' for source compatibility and
--    lets revisit reminders pass 'pending'.
------------------------------------------------------------------------------
create or replace function private.enqueue_customer_line_notification(
  target_org uuid,
  p_customer_id uuid,
  p_template_key text,
  p_template_version integer,
  p_payload jsonb,
  p_dedupe_key text,
  p_related_type text,
  p_related_id uuid,
  p_approval_status text
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
  v_approval text := coalesce(nullif(btrim(p_approval_status), ''), 'not_required');
begin
  if v_approval not in ('not_required', 'pending', 'approved') then
    raise exception using errcode = '22023', message = 'NOTIFICATION_APPROVAL_STATUS_INVALID';
  end if;

  select id into v_channel_id
  from public.line_channels
  where organization_id = target_org and status = 'active'
  order by created_at, id
  limit 1;

  if v_channel_id is null then
    return jsonb_build_object('status', 'skipped', 'reason', 'no_active_line_channel');
  end if;

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
    v_identity_id, null, v_approval, null
  );

  return jsonb_build_object(
    'status', case when v_approval = 'pending' then 'pending_approval' else 'pending' end,
    'approvalStatus', v_approval,
    'enqueued', v_enqueue -> 'enqueued',
    'notificationId', v_enqueue -> 'notificationId'
  );
end;
$$;

alter function private.enqueue_customer_line_notification(uuid, uuid, text, integer, jsonb, text, text, uuid, text)
  owner to renoly_rls_owner;
revoke all on function private.enqueue_customer_line_notification(uuid, uuid, text, integer, jsonb, text, text, uuid, text)
  from public, anon, authenticated, service_role;

------------------------------------------------------------------------------
-- 4. Payment milestone projections + lifecycle.
--
-- State machine (database-spec 10.7):
--   pending  -> invoiced | paid | waived | cancelled
--   invoiced -> overdue  | paid | waived | cancelled
--   overdue  -> paid | waived | cancelled
--   paid / waived / cancelled are terminal.
--
-- Role model (all enforced inside the SECURITY DEFINER RPC via has_org_role):
--   create/invoice : owner, admin, dispatcher, accountant
--   mark-paid/waive/cancel : owner, admin, accountant
--   reverse : owner, admin only (+ mandatory reason)
--   read : owner, admin, dispatcher, accountant, viewer see amounts;
--          everyone else (technician) gets an amount-free DTO.
------------------------------------------------------------------------------

-- Full financial DTO. Callers gate visibility before invoking; this always
-- includes amounts and is used for the manager/accountant projection.
create or replace function private.payment_milestone_json(
  target_org uuid,
  target_milestone uuid,
  p_include_amounts boolean
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_row public.payment_milestones%rowtype;
  v_tz text;
  v_base jsonb;
begin
  select * into v_row
  from public.payment_milestones
  where organization_id = target_org and id = target_milestone;
  if not found then
    raise exception using errcode = 'P0002', message = 'PAYMENT_MILESTONE_NOT_FOUND';
  end if;

  select timezone into v_tz from public.organizations where id = target_org;

  v_base := jsonb_build_object(
    'id', v_row.id,
    'organizationId', v_row.organization_id,
    'projectId', v_row.project_id,
    'quoteVersionId', v_row.quote_version_id,
    'changeOrderId', v_row.change_order_id,
    'name', v_row.name,
    'sequenceNo', v_row.sequence_no,
    'status', v_row.status,
    'dueOn', v_row.due_on,
    'invoicedAt', v_row.invoiced_at,
    'paidAt', v_row.paid_at,
    'waivedAt', v_row.waived_at,
    'cancelledAt', v_row.cancelled_at,
    'paymentMethod', v_row.payment_method,
    'externalReference', v_row.external_reference,
    'notes', v_row.notes,
    'lockVersion', v_row.lock_version,
    'createdAt', v_row.created_at,
    'updatedAt', v_row.updated_at,
    'timezone', v_tz
  );

  if p_include_amounts then
    v_base := v_base || jsonb_build_object(
      'amountMinor', v_row.amount_minor,
      'currency', v_row.currency
    );
  end if;

  return v_base;
end;
$$;

alter function private.payment_milestone_json(uuid, uuid, boolean) owner to renoly_rls_owner;
revoke all on function private.payment_milestone_json(uuid, uuid, boolean)
  from public, anon, authenticated, service_role;

-- Sensitive-field screen for mark-paid. mark-paid is tracking only; if any key or
-- value in the supplied payment metadata resembles a card number / CVV / bank
-- secret we reject with 422 and record a CONTENTLESS security event (no raw value).
create or replace function private.pilot_screen_payment_sensitive(p_payload jsonb)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  v_key text;
  v_val text;
  v_digits text;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    return false;
  end if;
  for v_key, v_val in select key, value from jsonb_each_text(p_payload)
  loop
    if lower(v_key) ~ '(card|cvv|cvc|pan|iban|routing|account_number|bank_secret|security_code|expiry|exp_month|exp_year)' then
      return true;
    end if;
    -- 13-19 contiguous digits (ignoring spaces/dashes) reads as a PAN.
    v_digits := regexp_replace(coalesce(v_val, ''), '[\s\-]', '', 'g');
    if v_digits ~ '^\d{13,19}$' then
      return true;
    end if;
    -- bare 3-4 digit CVV supplied under a numeric-looking value is allowed
    -- (amounts), but a value labelled cvv already caught above.
  end loop;
  return false;
end;
$$;

alter function private.pilot_screen_payment_sensitive(jsonb) owner to renoly_rls_owner;
revoke all on function private.pilot_screen_payment_sensitive(jsonb)
  from public, anon, authenticated, service_role;

-- create_payment_milestone: build a milestone from an accepted quote version or a
-- completed work order's project. sequence_no auto-assigned per project.
create or replace function public.create_payment_milestone(
  target_org uuid,
  p_project_id uuid,
  p_name text,
  p_amount_minor bigint,
  p_due_on date default null,
  p_quote_version_id uuid default null,
  p_change_order_id uuid default null,
  p_currency text default 'TWD',
  p_notes text default '',
  p_occurred_at timestamptz default null,
  p_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_actor uuid := (select private.current_actor_user_id());
  v_id uuid;
  v_seq integer;
begin
  if not public.has_org_role(target_org, array['owner', 'admin', 'dispatcher', 'accountant']::text[]) then
    raise exception using errcode = '42501', message = 'PAYMENT_ROLE_REQUIRED';
  end if;
  if nullif(btrim(p_name), '') is null or char_length(p_name) > 120 then
    raise exception using errcode = '22023', message = 'PAYMENT_PAYLOAD_INVALID';
  end if;
  if p_amount_minor is null or p_amount_minor <= 0 then
    raise exception using errcode = '22023', message = 'PAYMENT_AMOUNT_INVALID';
  end if;
  if coalesce(p_currency, 'TWD') !~ '^[A-Z]{3}$' then
    raise exception using errcode = '22023', message = 'PAYMENT_PAYLOAD_INVALID';
  end if;

  perform 1
  from public.projects
  where organization_id = target_org and id = p_project_id
  for share;
  if not found then
    raise exception using errcode = 'P0002', message = 'PROJECT_NOT_FOUND';
  end if;

  if p_quote_version_id is not null and not exists (
    select 1 from public.quote_versions
    where organization_id = target_org and id = p_quote_version_id
  ) then
    raise exception using errcode = 'P0002', message = 'QUOTE_VERSION_NOT_FOUND';
  end if;
  if p_change_order_id is not null and not exists (
    select 1 from public.change_orders
    where organization_id = target_org and id = p_change_order_id
  ) then
    raise exception using errcode = 'P0002', message = 'CHANGE_ORDER_NOT_FOUND';
  end if;

  select coalesce(max(sequence_no), 0) + 1 into v_seq
  from public.payment_milestones
  where organization_id = target_org and project_id = p_project_id;

  insert into public.payment_milestones (
    organization_id, project_id, quote_version_id, change_order_id, name,
    sequence_no, amount_minor, currency, due_on, status, notes,
    created_by, updated_by
  ) values (
    target_org, p_project_id, p_quote_version_id, p_change_order_id, btrim(p_name),
    v_seq, p_amount_minor, coalesce(p_currency, 'TWD'), p_due_on, 'pending',
    coalesce(p_notes, ''), v_actor, v_actor
  )
  returning id into v_id;

  perform private.append_user_event(
    target_org, 'payment_milestone', v_id, 'payment_milestone.created',
    jsonb_build_object(
      'projectId', p_project_id, 'sequenceNo', v_seq, 'amountMinor', p_amount_minor,
      'currency', coalesce(p_currency, 'TWD'), 'dueOn', p_due_on
    ),
    p_request_id, null, p_occurred_at
  );

  return private.payment_milestone_json(target_org, v_id, true);
end;
$$;

alter function public.create_payment_milestone(uuid, uuid, text, bigint, date, uuid, uuid, text, text, timestamptz, uuid)
  owner to renoly_rls_owner;
revoke all on function public.create_payment_milestone(uuid, uuid, text, bigint, date, uuid, uuid, text, text, timestamptz, uuid)
  from public, anon, service_role;
grant execute on function public.create_payment_milestone(uuid, uuid, text, bigint, date, uuid, uuid, text, text, timestamptz, uuid)
  to authenticated;

-- invoice_payment_milestone: pending -> invoiced. Enqueues a payment_reminder
-- draft (not_required; a request/invoice notice, not a revisit approval gate).
create or replace function public.invoice_payment_milestone(
  target_org uuid,
  target_milestone uuid,
  p_expected_lock_version integer,
  p_due_on date default null,
  p_occurred_at timestamptz default null,
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
  v_row public.payment_milestones%rowtype;
  v_project public.projects%rowtype;
  v_notify jsonb := null;
begin
  if not public.has_org_role(target_org, array['owner', 'admin', 'dispatcher', 'accountant']::text[]) then
    raise exception using errcode = '42501', message = 'PAYMENT_ROLE_REQUIRED';
  end if;

  select * into v_row from public.payment_milestones
  where organization_id = target_org and id = target_milestone
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'PAYMENT_MILESTONE_NOT_FOUND';
  end if;
  if v_row.lock_version is distinct from p_expected_lock_version then
    raise exception using errcode = '40001', message = 'STALE_VERSION';
  end if;
  if v_row.status <> 'pending' then
    raise exception using errcode = '23514', message = 'PAYMENT_MILESTONE_NOT_INVOICEABLE';
  end if;

  update public.payment_milestones
  set status = 'invoiced',
      invoiced_at = coalesce(invoiced_at, clock_timestamp()),
      due_on = coalesce(p_due_on, due_on),
      updated_by = v_actor,
      lock_version = lock_version + 1
  where organization_id = target_org and id = target_milestone
  returning * into v_row;

  select * into v_project from public.projects
  where organization_id = target_org and id = v_row.project_id;

  if v_project.customer_id is not null then
    v_notify := private.enqueue_customer_line_notification(
      target_org, v_project.customer_id, 'payment_reminder', 1,
      jsonb_build_object('milestoneName', v_row.name),
      'pm:' || target_milestone::text || ':invoiced',
      'payment_milestone', target_milestone
    );
  end if;

  perform private.append_user_event(
    target_org, 'payment_milestone', target_milestone, 'payment_milestone.invoiced',
    jsonb_build_object('dueOn', v_row.due_on, 'notification', v_notify),
    p_request_id, p_idempotency_key, p_occurred_at
  );

  return private.payment_milestone_json(target_org, target_milestone, true);
end;
$$;

alter function public.invoice_payment_milestone(uuid, uuid, integer, date, timestamptz, text, uuid)
  owner to renoly_rls_owner;
revoke all on function public.invoice_payment_milestone(uuid, uuid, integer, date, timestamptz, text, uuid)
  from public, anon, service_role;
grant execute on function public.invoice_payment_milestone(uuid, uuid, integer, date, timestamptz, text, uuid)
  to authenticated;

-- mark_payment_milestone_paid: pending/invoiced/overdue -> paid. TRACKING ONLY.
-- Rejects sensitive payment-instrument fields with 422 + contentless security event.
create or replace function public.mark_payment_milestone_paid(
  target_org uuid,
  target_milestone uuid,
  p_expected_lock_version integer,
  p_payment_method text default null,
  p_external_reference text default null,
  p_paid_at timestamptz default null,
  p_metadata jsonb default '{}'::jsonb,
  p_occurred_at timestamptz default null,
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
  v_row public.payment_milestones%rowtype;
begin
  if not public.has_org_role(target_org, array['owner', 'admin', 'accountant']::text[]) then
    raise exception using errcode = '42501', message = 'PAYMENT_ROLE_REQUIRED';
  end if;

  -- Screen BEFORE any state change or lock. On a hit we record a contentless
  -- security event and raise 422 (mapped to PAYMENT_SENSITIVE_FIELD_REJECTED).
  if private.pilot_screen_payment_sensitive(p_metadata)
     or private.pilot_screen_payment_sensitive(
          jsonb_build_object('payment_method', coalesce(p_payment_method, ''),
                             'external_reference', coalesce(p_external_reference, ''))
        ) then
    perform private.append_system_event(
      target_org, 'payment_milestone', target_milestone, 'payment_milestone.sensitive_field_rejected',
      jsonb_build_object('reason', 'sensitive_payment_field_detected'),
      p_request_id, p_idempotency_key, p_occurred_at
    );
    raise exception using errcode = 'RENSF', message = 'PAYMENT_SENSITIVE_FIELD_REJECTED';
  end if;

  if p_payment_method is not null
     and p_payment_method not in ('cash', 'transfer', 'card', 'other') then
    raise exception using errcode = '22023', message = 'PAYMENT_PAYLOAD_INVALID';
  end if;

  select * into v_row from public.payment_milestones
  where organization_id = target_org and id = target_milestone
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'PAYMENT_MILESTONE_NOT_FOUND';
  end if;
  if v_row.lock_version is distinct from p_expected_lock_version then
    raise exception using errcode = '40001', message = 'STALE_VERSION';
  end if;
  if v_row.status not in ('pending', 'invoiced', 'overdue') then
    raise exception using errcode = '23514', message = 'PAYMENT_MILESTONE_NOT_PAYABLE';
  end if;

  update public.payment_milestones
  set status = 'paid',
      paid_at = coalesce(p_paid_at, clock_timestamp()),
      payment_method = coalesce(p_payment_method, payment_method),
      external_reference = coalesce(nullif(btrim(p_external_reference), ''), external_reference),
      updated_by = v_actor,
      lock_version = lock_version + 1
  where organization_id = target_org and id = target_milestone
  returning * into v_row;

  perform private.append_user_event(
    target_org, 'payment_milestone', target_milestone, 'payment_milestone.paid',
    jsonb_build_object(
      'amountMinor', v_row.amount_minor, 'currency', v_row.currency,
      'paymentMethod', v_row.payment_method, 'paidAt', v_row.paid_at
    ),
    p_request_id, p_idempotency_key, p_occurred_at
  );

  return private.payment_milestone_json(target_org, target_milestone, true);
end;
$$;

alter function public.mark_payment_milestone_paid(uuid, uuid, integer, text, text, timestamptz, jsonb, timestamptz, text, uuid)
  owner to renoly_rls_owner;
revoke all on function public.mark_payment_milestone_paid(uuid, uuid, integer, text, text, timestamptz, jsonb, timestamptz, text, uuid)
  from public, anon, service_role;
grant execute on function public.mark_payment_milestone_paid(uuid, uuid, integer, text, text, timestamptz, jsonb, timestamptz, text, uuid)
  to authenticated;

-- waive_payment_milestone: pending/invoiced/overdue -> waived (reason required).
create or replace function public.waive_payment_milestone(
  target_org uuid,
  target_milestone uuid,
  p_expected_lock_version integer,
  p_reason text,
  p_occurred_at timestamptz default null,
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
  v_row public.payment_milestones%rowtype;
begin
  if not public.has_org_role(target_org, array['owner', 'admin', 'accountant']::text[]) then
    raise exception using errcode = '42501', message = 'PAYMENT_ROLE_REQUIRED';
  end if;
  if nullif(btrim(p_reason), '') is null then
    raise exception using errcode = '22023', message = 'PAYMENT_REASON_REQUIRED';
  end if;

  select * into v_row from public.payment_milestones
  where organization_id = target_org and id = target_milestone
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'PAYMENT_MILESTONE_NOT_FOUND';
  end if;
  if v_row.lock_version is distinct from p_expected_lock_version then
    raise exception using errcode = '40001', message = 'STALE_VERSION';
  end if;
  if v_row.status not in ('pending', 'invoiced', 'overdue') then
    raise exception using errcode = '23514', message = 'PAYMENT_MILESTONE_NOT_WAIVABLE';
  end if;

  update public.payment_milestones
  set status = 'waived',
      waived_at = clock_timestamp(),
      updated_by = v_actor,
      lock_version = lock_version + 1
  where organization_id = target_org and id = target_milestone;

  perform private.append_user_event(
    target_org, 'payment_milestone', target_milestone, 'payment_milestone.waived',
    jsonb_build_object('reason', btrim(p_reason)),
    p_request_id, p_idempotency_key, p_occurred_at
  );

  return private.payment_milestone_json(target_org, target_milestone, true);
end;
$$;

alter function public.waive_payment_milestone(uuid, uuid, integer, text, timestamptz, text, uuid)
  owner to renoly_rls_owner;
revoke all on function public.waive_payment_milestone(uuid, uuid, integer, text, timestamptz, text, uuid)
  from public, anon, service_role;
grant execute on function public.waive_payment_milestone(uuid, uuid, integer, text, timestamptz, text, uuid)
  to authenticated;

-- cancel_payment_milestone: pending/invoiced/overdue -> cancelled (reason required).
create or replace function public.cancel_payment_milestone(
  target_org uuid,
  target_milestone uuid,
  p_expected_lock_version integer,
  p_reason text,
  p_occurred_at timestamptz default null,
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
  v_row public.payment_milestones%rowtype;
begin
  if not public.has_org_role(target_org, array['owner', 'admin', 'accountant']::text[]) then
    raise exception using errcode = '42501', message = 'PAYMENT_ROLE_REQUIRED';
  end if;
  if nullif(btrim(p_reason), '') is null then
    raise exception using errcode = '22023', message = 'PAYMENT_REASON_REQUIRED';
  end if;

  select * into v_row from public.payment_milestones
  where organization_id = target_org and id = target_milestone
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'PAYMENT_MILESTONE_NOT_FOUND';
  end if;
  if v_row.lock_version is distinct from p_expected_lock_version then
    raise exception using errcode = '40001', message = 'STALE_VERSION';
  end if;
  if v_row.status not in ('pending', 'invoiced', 'overdue') then
    raise exception using errcode = '23514', message = 'PAYMENT_MILESTONE_NOT_CANCELLABLE';
  end if;

  update public.payment_milestones
  set status = 'cancelled',
      cancelled_at = clock_timestamp(),
      updated_by = v_actor,
      lock_version = lock_version + 1
  where organization_id = target_org and id = target_milestone;

  perform private.append_user_event(
    target_org, 'payment_milestone', target_milestone, 'payment_milestone.cancelled',
    jsonb_build_object('reason', btrim(p_reason)),
    p_request_id, p_idempotency_key, p_occurred_at
  );

  return private.payment_milestone_json(target_org, target_milestone, true);
end;
$$;

alter function public.cancel_payment_milestone(uuid, uuid, integer, text, timestamptz, text, uuid)
  owner to renoly_rls_owner;
revoke all on function public.cancel_payment_milestone(uuid, uuid, integer, text, timestamptz, text, uuid)
  from public, anon, service_role;
grant execute on function public.cancel_payment_milestone(uuid, uuid, integer, text, timestamptz, text, uuid)
  to authenticated;

-- reverse_payment_milestone: paid -> invoiced. Owner/admin only, reason required.
-- Never rewrites amount_minor. Correction for a mistaken mark-paid.
create or replace function public.reverse_payment_milestone(
  target_org uuid,
  target_milestone uuid,
  p_expected_lock_version integer,
  p_reason text,
  p_occurred_at timestamptz default null,
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
  v_row public.payment_milestones%rowtype;
  v_prior_amount bigint;
begin
  if not public.has_org_role(target_org, array['owner', 'admin']::text[]) then
    raise exception using errcode = '42501', message = 'PAYMENT_REVERSE_ROLE_REQUIRED';
  end if;
  if nullif(btrim(p_reason), '') is null then
    raise exception using errcode = '22023', message = 'PAYMENT_REVERSE_REASON_REQUIRED';
  end if;

  select * into v_row from public.payment_milestones
  where organization_id = target_org and id = target_milestone
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'PAYMENT_MILESTONE_NOT_FOUND';
  end if;
  if v_row.lock_version is distinct from p_expected_lock_version then
    raise exception using errcode = '40001', message = 'STALE_VERSION';
  end if;
  if v_row.status <> 'paid' then
    raise exception using errcode = '23514', message = 'PAYMENT_MILESTONE_NOT_REVERSIBLE';
  end if;
  v_prior_amount := v_row.amount_minor;

  update public.payment_milestones
  set status = 'invoiced',
      paid_at = null,
      payment_method = null,
      updated_by = v_actor,
      lock_version = lock_version + 1
  where organization_id = target_org and id = target_milestone
  returning * into v_row;

  -- Invariant: amount is never touched by a reversal.
  if v_row.amount_minor is distinct from v_prior_amount then
    raise exception using errcode = 'XX000', message = 'PAYMENT_REVERSE_AMOUNT_MUTATED';
  end if;

  perform private.append_user_event(
    target_org, 'payment_milestone', target_milestone, 'payment_milestone.reversed',
    jsonb_build_object('reason', btrim(p_reason), 'amountMinor', v_row.amount_minor),
    p_request_id, p_idempotency_key, p_occurred_at
  );

  return private.payment_milestone_json(target_org, target_milestone, true);
end;
$$;

alter function public.reverse_payment_milestone(uuid, uuid, integer, text, timestamptz, text, uuid)
  owner to renoly_rls_owner;
revoke all on function public.reverse_payment_milestone(uuid, uuid, integer, text, timestamptz, text, uuid)
  from public, anon, service_role;
grant execute on function public.reverse_payment_milestone(uuid, uuid, integer, text, timestamptz, text, uuid)
  to authenticated;

-- mark_payments_overdue: worker. invoiced milestones whose org-tz due_on is in the
-- past become overdue. Idempotent (only invoiced rows move). service_role only.
create or replace function public.mark_payments_overdue(
  p_now timestamptz default null,
  p_limit integer default 500
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_now timestamptz := coalesce(p_now, clock_timestamp());
  v_limit integer := greatest(1, least(coalesce(p_limit, 500), 5000));
  v_ids uuid[];
  v_orgs uuid[];
  v_id uuid;
  v_org uuid;
  v_count integer := 0;
begin
  with due as (
    select pm.id, pm.organization_id
    from public.payment_milestones pm
    join public.organizations o on o.id = pm.organization_id
    where pm.status = 'invoiced'
      and pm.due_on is not null
      -- Overdue once the org-local calendar day has fully passed the due date.
      and pm.due_on < ((v_now at time zone o.timezone)::date)
    order by pm.due_on, pm.id
    limit v_limit
    for update of pm skip locked
  ),
  moved as (
    update public.payment_milestones pm
    set status = 'overdue',
        updated_at = clock_timestamp(),
        lock_version = pm.lock_version + 1
    from due
    where pm.id = due.id
    returning pm.id, pm.organization_id
  )
  select array_agg(id), array_agg(organization_id) into v_ids, v_orgs from moved;

  if v_ids is not null then
    for i in 1 .. array_length(v_ids, 1) loop
      v_id := v_ids[i];
      v_org := v_orgs[i];
      perform private.append_system_event(
        v_org, 'payment_milestone', v_id, 'payment_milestone.overdue',
        jsonb_build_object('detectedAt', v_now), null, null, v_now
      );
      v_count := v_count + 1;
    end loop;
  end if;

  return jsonb_build_object('markedOverdue', v_count);
end;
$$;

alter function public.mark_payments_overdue(timestamptz, integer) owner to renoly_rls_owner;
revoke all on function public.mark_payments_overdue(timestamptz, integer)
  from public, anon, authenticated;
grant execute on function public.mark_payments_overdue(timestamptz, integer) to service_role;

-- list_pilot_payment_milestones: authenticated projection. Financial roles get
-- amounts; technicians (assigned-only visibility) get an amount-free DTO. Filters
-- by project and/or status; cursor by (sequence_no, id).
create or replace function public.list_pilot_payment_milestones(
  target_org uuid,
  p_project_id uuid default null,
  p_status text default null,
  p_limit integer default 50
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_include_amounts boolean;
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 200));
  v_rows jsonb;
begin
  if not public.has_org_role(
    target_org, array['owner', 'admin', 'dispatcher', 'accountant', 'viewer', 'technician']::text[]
  ) then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;
  v_include_amounts := public.has_org_role(
    target_org, array['owner', 'admin', 'dispatcher', 'accountant', 'viewer']::text[]
  );

  select coalesce(jsonb_agg(row order by seq_no, id_txt), '[]'::jsonb) into v_rows
  from (
    select
      pm.sequence_no as seq_no, pm.id::text as id_txt,
      private.payment_milestone_json(target_org, pm.id, v_include_amounts) as row
    from public.payment_milestones pm
    where pm.organization_id = target_org
      and (p_project_id is null or pm.project_id = p_project_id)
      and (p_status is null or pm.status = p_status)
    order by pm.sequence_no, pm.id
    limit v_limit
  ) s;

  return jsonb_build_object('milestones', v_rows, 'includeAmounts', v_include_amounts);
end;
$$;

alter function public.list_pilot_payment_milestones(uuid, uuid, text, integer)
  owner to renoly_rls_owner;
revoke all on function public.list_pilot_payment_milestones(uuid, uuid, text, integer)
  from public, anon, service_role;
grant execute on function public.list_pilot_payment_milestones(uuid, uuid, text, integer)
  to authenticated;

-- get_pilot_payment_milestone_detail: single milestone with the same redaction.
create or replace function public.get_pilot_payment_milestone_detail(
  target_org uuid,
  target_milestone uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_include_amounts boolean;
begin
  if not public.has_org_role(
    target_org, array['owner', 'admin', 'dispatcher', 'accountant', 'viewer', 'technician']::text[]
  ) then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;
  v_include_amounts := public.has_org_role(
    target_org, array['owner', 'admin', 'dispatcher', 'accountant', 'viewer']::text[]
  );
  return private.payment_milestone_json(target_org, target_milestone, v_include_amounts);
end;
$$;

alter function public.get_pilot_payment_milestone_detail(uuid, uuid)
  owner to renoly_rls_owner;
revoke all on function public.get_pilot_payment_milestone_detail(uuid, uuid)
  from public, anon, service_role;
grant execute on function public.get_pilot_payment_milestone_detail(uuid, uuid)
  to authenticated;

------------------------------------------------------------------------------
-- 5. Maintenance plans + revisit reminders.
--
-- State machine: active <-> paused; active/paused -> completed | cancelled.
-- next_due_on is recomputed on complete: (org-local completion date) + cadence
-- months. Reminders enqueue through the approval-pending overload so they hold
-- until a human approves (no auto-repair).
------------------------------------------------------------------------------

create or replace function private.maintenance_plan_json(
  target_org uuid,
  target_plan uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_row public.maintenance_plans%rowtype;
begin
  select * into v_row from public.maintenance_plans
  where organization_id = target_org and id = target_plan;
  if not found then
    raise exception using errcode = 'P0002', message = 'MAINTENANCE_PLAN_NOT_FOUND';
  end if;
  return jsonb_build_object(
    'id', v_row.id,
    'organizationId', v_row.organization_id,
    'customerId', v_row.customer_id,
    'locationId', v_row.location_id,
    'assetId', v_row.asset_id,
    'serviceCatalogItemId', v_row.service_catalog_item_id,
    'name', v_row.name,
    'cadenceMonths', v_row.cadence_months,
    'leadDays', v_row.lead_days,
    'nextDueOn', v_row.next_due_on,
    'lastCompletedWorkOrderId', v_row.last_completed_work_order_id,
    'status', v_row.status,
    'autoPrepareMessage', v_row.auto_prepare_message,
    'pausedAt', v_row.paused_at,
    'completedAt', v_row.completed_at,
    'cancelledAt', v_row.cancelled_at,
    'lockVersion', v_row.lock_version,
    'createdAt', v_row.created_at,
    'updatedAt', v_row.updated_at
  );
end;
$$;

alter function private.maintenance_plan_json(uuid, uuid) owner to renoly_rls_owner;
revoke all on function private.maintenance_plan_json(uuid, uuid)
  from public, anon, authenticated, service_role;

create or replace function public.create_maintenance_plan(
  target_org uuid,
  p_customer_id uuid,
  p_location_id uuid,
  p_name text,
  p_cadence_months integer,
  p_next_due_on date,
  p_asset_id uuid default null,
  p_service_catalog_item_id uuid default null,
  p_lead_days integer default 14,
  p_auto_prepare_message boolean default true,
  p_occurred_at timestamptz default null,
  p_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_actor uuid := (select private.current_actor_user_id());
  v_id uuid;
begin
  if not public.has_org_role(target_org, array['owner', 'admin', 'dispatcher']::text[]) then
    raise exception using errcode = '42501', message = 'MAINTENANCE_ROLE_REQUIRED';
  end if;
  if nullif(btrim(p_name), '') is null or char_length(p_name) > 160 then
    raise exception using errcode = '22023', message = 'MAINTENANCE_PAYLOAD_INVALID';
  end if;
  if p_cadence_months is null or p_cadence_months not between 1 and 60 then
    raise exception using errcode = '22023', message = 'MAINTENANCE_CADENCE_INVALID';
  end if;
  if p_next_due_on is null then
    raise exception using errcode = '22023', message = 'MAINTENANCE_PAYLOAD_INVALID';
  end if;
  if coalesce(p_lead_days, 14) not between 0 and 90 then
    raise exception using errcode = '22023', message = 'MAINTENANCE_PAYLOAD_INVALID';
  end if;

  insert into public.maintenance_plans (
    organization_id, customer_id, location_id, asset_id, service_catalog_item_id,
    name, cadence_months, lead_days, next_due_on, status, auto_prepare_message,
    created_by, updated_by
  ) values (
    target_org, p_customer_id, p_location_id, p_asset_id, p_service_catalog_item_id,
    btrim(p_name), p_cadence_months, coalesce(p_lead_days, 14), p_next_due_on, 'active',
    coalesce(p_auto_prepare_message, true), v_actor, v_actor
  )
  returning id into v_id;

  perform private.append_user_event(
    target_org, 'maintenance_plan', v_id, 'maintenance_plan.created',
    jsonb_build_object(
      'customerId', p_customer_id, 'assetId', p_asset_id,
      'cadenceMonths', p_cadence_months, 'nextDueOn', p_next_due_on
    ),
    p_request_id, null, p_occurred_at
  );

  return private.maintenance_plan_json(target_org, v_id);
end;
$$;

alter function public.create_maintenance_plan(uuid, uuid, uuid, text, integer, date, uuid, uuid, integer, boolean, timestamptz, uuid)
  owner to renoly_rls_owner;
revoke all on function public.create_maintenance_plan(uuid, uuid, uuid, text, integer, date, uuid, uuid, integer, boolean, timestamptz, uuid)
  from public, anon, service_role;
grant execute on function public.create_maintenance_plan(uuid, uuid, uuid, text, integer, date, uuid, uuid, integer, boolean, timestamptz, uuid)
  to authenticated;

create or replace function public.patch_maintenance_plan(
  target_org uuid,
  target_plan uuid,
  p_expected_lock_version integer,
  p_name text default null,
  p_cadence_months integer default null,
  p_lead_days integer default null,
  p_next_due_on date default null,
  p_auto_prepare_message boolean default null,
  p_occurred_at timestamptz default null,
  p_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_actor uuid := (select private.current_actor_user_id());
  v_row public.maintenance_plans%rowtype;
begin
  if not public.has_org_role(target_org, array['owner', 'admin', 'dispatcher']::text[]) then
    raise exception using errcode = '42501', message = 'MAINTENANCE_ROLE_REQUIRED';
  end if;
  if p_cadence_months is not null and p_cadence_months not between 1 and 60 then
    raise exception using errcode = '22023', message = 'MAINTENANCE_CADENCE_INVALID';
  end if;
  if p_lead_days is not null and p_lead_days not between 0 and 90 then
    raise exception using errcode = '22023', message = 'MAINTENANCE_PAYLOAD_INVALID';
  end if;
  if p_name is not null and (nullif(btrim(p_name), '') is null or char_length(p_name) > 160) then
    raise exception using errcode = '22023', message = 'MAINTENANCE_PAYLOAD_INVALID';
  end if;

  select * into v_row from public.maintenance_plans
  where organization_id = target_org and id = target_plan
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'MAINTENANCE_PLAN_NOT_FOUND';
  end if;
  if v_row.lock_version is distinct from p_expected_lock_version then
    raise exception using errcode = '40001', message = 'STALE_VERSION';
  end if;
  if v_row.status not in ('active', 'paused') then
    raise exception using errcode = '23514', message = 'MAINTENANCE_PLAN_NOT_EDITABLE';
  end if;

  update public.maintenance_plans
  set name = coalesce(nullif(btrim(p_name), ''), name),
      cadence_months = coalesce(p_cadence_months, cadence_months),
      lead_days = coalesce(p_lead_days, lead_days),
      next_due_on = coalesce(p_next_due_on, next_due_on),
      auto_prepare_message = coalesce(p_auto_prepare_message, auto_prepare_message),
      updated_by = v_actor,
      lock_version = lock_version + 1
  where organization_id = target_org and id = target_plan;

  perform private.append_user_event(
    target_org, 'maintenance_plan', target_plan, 'maintenance_plan.updated',
    jsonb_build_object('fields', jsonb_build_object(
      'name', p_name is not null, 'cadenceMonths', p_cadence_months is not null,
      'leadDays', p_lead_days is not null, 'nextDueOn', p_next_due_on is not null
    )),
    p_request_id, null, p_occurred_at
  );

  return private.maintenance_plan_json(target_org, target_plan);
end;
$$;

alter function public.patch_maintenance_plan(uuid, uuid, integer, text, integer, integer, date, boolean, timestamptz, uuid)
  owner to renoly_rls_owner;
revoke all on function public.patch_maintenance_plan(uuid, uuid, integer, text, integer, integer, date, boolean, timestamptz, uuid)
  from public, anon, service_role;
grant execute on function public.patch_maintenance_plan(uuid, uuid, integer, text, integer, integer, date, boolean, timestamptz, uuid)
  to authenticated;

-- pause / resume / cancel share this transition primitive.
create or replace function private.transition_maintenance_plan(
  target_org uuid,
  target_plan uuid,
  p_target_status text,
  p_expected_lock_version integer,
  p_reason text,
  p_occurred_at timestamptz,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_actor uuid := (select private.current_actor_user_id());
  v_row public.maintenance_plans%rowtype;
  v_allowed boolean;
begin
  select * into v_row from public.maintenance_plans
  where organization_id = target_org and id = target_plan
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'MAINTENANCE_PLAN_NOT_FOUND';
  end if;
  if v_row.lock_version is distinct from p_expected_lock_version then
    raise exception using errcode = '40001', message = 'STALE_VERSION';
  end if;

  v_allowed := case p_target_status
    when 'paused' then v_row.status = 'active'
    when 'active' then v_row.status = 'paused'
    when 'cancelled' then v_row.status in ('active', 'paused')
    else false
  end;
  if not v_allowed then
    raise exception using errcode = '23514', message = 'MAINTENANCE_PLAN_TRANSITION_INVALID';
  end if;
  if p_target_status = 'cancelled' and nullif(btrim(p_reason), '') is null then
    raise exception using errcode = '22023', message = 'MAINTENANCE_REASON_REQUIRED';
  end if;

  update public.maintenance_plans
  set status = p_target_status,
      paused_at = case when p_target_status = 'paused' then clock_timestamp()
                       when p_target_status = 'active' then null
                       else paused_at end,
      cancelled_at = case when p_target_status = 'cancelled' then clock_timestamp() else cancelled_at end,
      updated_by = v_actor,
      lock_version = lock_version + 1
  where organization_id = target_org and id = target_plan;

  perform private.append_user_event(
    target_org, 'maintenance_plan', target_plan, 'maintenance_plan.' ||
      case p_target_status when 'paused' then 'paused' when 'active' then 'resumed' else 'cancelled' end,
    case when p_reason is not null then jsonb_build_object('reason', btrim(p_reason)) else '{}'::jsonb end,
    p_request_id, null, p_occurred_at
  );

  return private.maintenance_plan_json(target_org, target_plan);
end;
$$;

alter function private.transition_maintenance_plan(uuid, uuid, text, integer, text, timestamptz, uuid)
  owner to renoly_rls_owner;
revoke all on function private.transition_maintenance_plan(uuid, uuid, text, integer, text, timestamptz, uuid)
  from public, anon, authenticated, service_role;

create or replace function public.pause_maintenance_plan(
  target_org uuid, target_plan uuid, p_expected_lock_version integer,
  p_occurred_at timestamptz default null, p_request_id uuid default null
)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, private
as $$
begin
  if not public.has_org_role(target_org, array['owner', 'admin', 'dispatcher']::text[]) then
    raise exception using errcode = '42501', message = 'MAINTENANCE_ROLE_REQUIRED';
  end if;
  return private.transition_maintenance_plan(target_org, target_plan, 'paused', p_expected_lock_version, null, p_occurred_at, p_request_id);
end;
$$;
alter function public.pause_maintenance_plan(uuid, uuid, integer, timestamptz, uuid) owner to renoly_rls_owner;
revoke all on function public.pause_maintenance_plan(uuid, uuid, integer, timestamptz, uuid) from public, anon, service_role;
grant execute on function public.pause_maintenance_plan(uuid, uuid, integer, timestamptz, uuid) to authenticated;

create or replace function public.resume_maintenance_plan(
  target_org uuid, target_plan uuid, p_expected_lock_version integer,
  p_occurred_at timestamptz default null, p_request_id uuid default null
)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, private
as $$
begin
  if not public.has_org_role(target_org, array['owner', 'admin', 'dispatcher']::text[]) then
    raise exception using errcode = '42501', message = 'MAINTENANCE_ROLE_REQUIRED';
  end if;
  return private.transition_maintenance_plan(target_org, target_plan, 'active', p_expected_lock_version, null, p_occurred_at, p_request_id);
end;
$$;
alter function public.resume_maintenance_plan(uuid, uuid, integer, timestamptz, uuid) owner to renoly_rls_owner;
revoke all on function public.resume_maintenance_plan(uuid, uuid, integer, timestamptz, uuid) from public, anon, service_role;
grant execute on function public.resume_maintenance_plan(uuid, uuid, integer, timestamptz, uuid) to authenticated;

create or replace function public.cancel_maintenance_plan(
  target_org uuid, target_plan uuid, p_expected_lock_version integer, p_reason text,
  p_occurred_at timestamptz default null, p_request_id uuid default null
)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, private
as $$
begin
  if not public.has_org_role(target_org, array['owner', 'admin', 'dispatcher']::text[]) then
    raise exception using errcode = '42501', message = 'MAINTENANCE_ROLE_REQUIRED';
  end if;
  return private.transition_maintenance_plan(target_org, target_plan, 'cancelled', p_expected_lock_version, p_reason, p_occurred_at, p_request_id);
end;
$$;
alter function public.cancel_maintenance_plan(uuid, uuid, integer, text, timestamptz, uuid) owner to renoly_rls_owner;
revoke all on function public.cancel_maintenance_plan(uuid, uuid, integer, text, timestamptz, uuid) from public, anon, service_role;
grant execute on function public.cancel_maintenance_plan(uuid, uuid, integer, text, timestamptz, uuid) to authenticated;

-- complete_maintenance_plan: a maintenance visit finished. Recompute next_due_on
-- as (org-local completion date) + cadence months, set last WO, keep plan active.
create or replace function public.complete_maintenance_plan(
  target_org uuid,
  target_plan uuid,
  p_expected_lock_version integer,
  p_completed_work_order_id uuid default null,
  p_completed_on date default null,
  p_occurred_at timestamptz default null,
  p_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_actor uuid := (select private.current_actor_user_id());
  v_row public.maintenance_plans%rowtype;
  v_tz text;
  v_base_date date;
  v_next date;
begin
  if not public.has_org_role(target_org, array['owner', 'admin', 'dispatcher']::text[]) then
    raise exception using errcode = '42501', message = 'MAINTENANCE_ROLE_REQUIRED';
  end if;

  select * into v_row from public.maintenance_plans
  where organization_id = target_org and id = target_plan
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'MAINTENANCE_PLAN_NOT_FOUND';
  end if;
  if v_row.lock_version is distinct from p_expected_lock_version then
    raise exception using errcode = '40001', message = 'STALE_VERSION';
  end if;
  if v_row.status <> 'active' then
    raise exception using errcode = '23514', message = 'MAINTENANCE_PLAN_NOT_COMPLETABLE';
  end if;

  if p_completed_work_order_id is not null and not exists (
    select 1 from public.work_orders
    where organization_id = target_org and id = p_completed_work_order_id
  ) then
    raise exception using errcode = 'P0002', message = 'WORK_ORDER_NOT_FOUND';
  end if;

  select timezone into v_tz from public.organizations where id = target_org;
  v_base_date := coalesce(p_completed_on, (coalesce(p_occurred_at, clock_timestamp()) at time zone v_tz)::date);
  v_next := (v_base_date + make_interval(months => v_row.cadence_months))::date;

  update public.maintenance_plans
  set next_due_on = v_next,
      last_completed_work_order_id = coalesce(p_completed_work_order_id, last_completed_work_order_id),
      completed_at = clock_timestamp(),
      updated_by = v_actor,
      lock_version = lock_version + 1
  where organization_id = target_org and id = target_plan;

  perform private.append_user_event(
    target_org, 'maintenance_plan', target_plan, 'maintenance_plan.serviced',
    jsonb_build_object(
      'completedOn', v_base_date, 'nextDueOn', v_next,
      'completedWorkOrderId', p_completed_work_order_id, 'timezone', v_tz
    ),
    p_request_id, null, p_occurred_at
  );

  return private.maintenance_plan_json(target_org, target_plan);
end;
$$;

alter function public.complete_maintenance_plan(uuid, uuid, integer, uuid, date, timestamptz, uuid)
  owner to renoly_rls_owner;
revoke all on function public.complete_maintenance_plan(uuid, uuid, integer, uuid, date, timestamptz, uuid)
  from public, anon, service_role;
grant execute on function public.complete_maintenance_plan(uuid, uuid, integer, uuid, date, timestamptz, uuid)
  to authenticated;

-- prepare_maintenance_reminders: staff drafts reminders for the given plan ids
-- (<=100). Each enqueues an approval-PENDING maintenance_reminder — never sent
-- until notifications:approve. Draft only (human-confirm gate). Idempotent per
-- plan+next_due_on via dedupe_key.
create or replace function public.prepare_maintenance_reminders(
  target_org uuid,
  p_plan_ids uuid[],
  p_occurred_at timestamptz default null,
  p_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_plan public.maintenance_plans%rowtype;
  v_id uuid;
  v_notify jsonb;
  v_prepared integer := 0;
  v_skipped integer := 0;
begin
  if not public.has_org_role(target_org, array['owner', 'admin', 'dispatcher']::text[]) then
    raise exception using errcode = '42501', message = 'MAINTENANCE_ROLE_REQUIRED';
  end if;
  if p_plan_ids is null or array_length(p_plan_ids, 1) is null then
    raise exception using errcode = '22023', message = 'MAINTENANCE_PAYLOAD_INVALID';
  end if;
  if array_length(p_plan_ids, 1) > 100 then
    raise exception using errcode = '22023', message = 'MAINTENANCE_BATCH_TOO_LARGE';
  end if;

  foreach v_id in array (select array_agg(distinct x) from unnest(p_plan_ids) x)
  loop
    select * into v_plan from public.maintenance_plans
    where organization_id = target_org and id = v_id;
    if not found or v_plan.status <> 'active' then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    v_notify := private.enqueue_customer_line_notification(
      target_org, v_plan.customer_id, 'maintenance_reminder', 1,
      jsonb_build_object('planName', v_plan.name, 'nextDueOn', v_plan.next_due_on),
      'mp:' || v_id::text || ':reminder:' || v_plan.next_due_on::text,
      'maintenance_plan', v_id,
      'pending'
    );

    perform private.append_user_event(
      target_org, 'maintenance_plan', v_id, 'maintenance_plan.reminder_prepared',
      jsonb_build_object('nextDueOn', v_plan.next_due_on, 'notification', v_notify),
      p_request_id, null, p_occurred_at
    );

    if v_notify ->> 'status' = 'pending_approval' then
      v_prepared := v_prepared + 1;
    else
      v_skipped := v_skipped + 1;
    end if;
  end loop;

  return jsonb_build_object('prepared', v_prepared, 'skipped', v_skipped);
end;
$$;

alter function public.prepare_maintenance_reminders(uuid, uuid[], timestamptz, uuid)
  owner to renoly_rls_owner;
revoke all on function public.prepare_maintenance_reminders(uuid, uuid[], timestamptz, uuid)
  from public, anon, service_role;
grant execute on function public.prepare_maintenance_reminders(uuid, uuid[], timestamptz, uuid)
  to authenticated;

-- approve_notifications: batch approve pending drafts (<=100). Only approval_status
-- 'pending' rows move to 'approved' with approver stamped; others are ignored.
create or replace function public.approve_notifications(
  target_org uuid,
  p_notification_ids uuid[],
  p_occurred_at timestamptz default null,
  p_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_actor uuid := (select private.current_actor_user_id());
  v_ids uuid[];
  v_approved integer;
  v_notif record;
begin
  if not public.has_org_role(target_org, array['owner', 'admin', 'dispatcher']::text[]) then
    raise exception using errcode = '42501', message = 'NOTIFICATION_APPROVE_ROLE_REQUIRED';
  end if;
  if p_notification_ids is null or array_length(p_notification_ids, 1) is null then
    raise exception using errcode = '22023', message = 'NOTIFICATION_PAYLOAD_INVALID';
  end if;
  if array_length(p_notification_ids, 1) > 100 then
    raise exception using errcode = '22023', message = 'NOTIFICATION_BATCH_TOO_LARGE';
  end if;

  with upd as (
    update public.notifications
    set approval_status = 'approved',
        updated_at = clock_timestamp()
    where organization_id = target_org
      and id = any(p_notification_ids)
      and approval_status = 'pending'
      and status in ('pending', 'failed')
    returning id
  )
  select array_agg(id) into v_ids from upd;

  v_approved := coalesce(array_length(v_ids, 1), 0);

  -- Record who approved against each approved notification's related aggregate so
  -- the approval is auditable (human-confirm gate) and the actor is captured.
  if v_approved > 0 then
    for v_notif in
      select n.id, n.related_type, n.related_id
      from public.notifications n
      where n.organization_id = target_org and n.id = any(v_ids)
        and n.related_type is not null and n.related_id is not null
    loop
      perform private.append_user_event(
        target_org, v_notif.related_type, v_notif.related_id,
        'notification.approved',
        jsonb_build_object('notificationId', v_notif.id, 'approvedBy', v_actor),
        p_request_id, null, p_occurred_at
      );
    end loop;
  end if;

  return jsonb_build_object('approved', v_approved);
end;
$$;

alter function public.approve_notifications(uuid, uuid[], timestamptz, uuid)
  owner to renoly_rls_owner;
revoke all on function public.approve_notifications(uuid, uuid[], timestamptz, uuid)
  from public, anon, service_role;
grant execute on function public.approve_notifications(uuid, uuid[], timestamptz, uuid)
  to authenticated;

-- scan_maintenance_due: worker. active plans whose org-tz (next_due_on - lead_days)
-- has arrived get exactly one approval-pending reminder enqueued (idempotent via
-- the plan+next_due_on dedupe_key). service_role only.
create or replace function public.scan_maintenance_due(
  p_now timestamptz default null,
  p_limit integer default 200
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_now timestamptz := coalesce(p_now, clock_timestamp());
  v_limit integer := greatest(1, least(coalesce(p_limit, 200), 2000));
  v_plan record;
  v_notify jsonb;
  v_enqueued integer := 0;
  v_skipped integer := 0;
begin
  for v_plan in
    select mp.id, mp.organization_id, mp.customer_id, mp.name, mp.next_due_on
    from public.maintenance_plans mp
    join public.organizations o on o.id = mp.organization_id
    where mp.status = 'active'
      and (mp.next_due_on - make_interval(days => mp.lead_days))
          <= ((v_now at time zone o.timezone)::date)
    order by mp.next_due_on, mp.id
    limit v_limit
  loop
    v_notify := private.enqueue_customer_line_notification(
      v_plan.organization_id, v_plan.customer_id, 'maintenance_reminder', 1,
      jsonb_build_object('planName', v_plan.name, 'nextDueOn', v_plan.next_due_on),
      'mp:' || v_plan.id::text || ':reminder:' || v_plan.next_due_on::text,
      'maintenance_plan', v_plan.id,
      'pending'
    );
    if (v_notify ->> 'status') = 'pending_approval' and (v_notify -> 'enqueued')::text = 'true' then
      v_enqueued := v_enqueued + 1;
      perform private.append_system_event(
        v_plan.organization_id, 'maintenance_plan', v_plan.id, 'maintenance_plan.reminder_scanned',
        jsonb_build_object('nextDueOn', v_plan.next_due_on, 'notification', v_notify),
        null, null, v_now
      );
    else
      v_skipped := v_skipped + 1;
    end if;
  end loop;

  return jsonb_build_object('enqueued', v_enqueued, 'skipped', v_skipped);
end;
$$;

alter function public.scan_maintenance_due(timestamptz, integer) owner to renoly_rls_owner;
revoke all on function public.scan_maintenance_due(timestamptz, integer)
  from public, anon, authenticated;
grant execute on function public.scan_maintenance_due(timestamptz, integer) to service_role;

create or replace function public.list_pilot_maintenance_plans(
  target_org uuid,
  p_status text default null,
  p_limit integer default 50
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_rows jsonb;
begin
  if not public.has_org_role(
    target_org, array['owner', 'admin', 'dispatcher', 'accountant', 'viewer']::text[]
  ) then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;

  select coalesce(jsonb_agg(row order by due_on, id_txt), '[]'::jsonb) into v_rows
  from (
    select mp.next_due_on as due_on, mp.id::text as id_txt,
      private.maintenance_plan_json(target_org, mp.id) as row
    from public.maintenance_plans mp
    where mp.organization_id = target_org
      and (p_status is null or mp.status = p_status)
    order by mp.next_due_on, mp.id
    limit greatest(1, least(coalesce(p_limit, 50), 200))
  ) s;

  return jsonb_build_object('plans', v_rows);
end;
$$;

alter function public.list_pilot_maintenance_plans(uuid, text, integer) owner to renoly_rls_owner;
revoke all on function public.list_pilot_maintenance_plans(uuid, text, integer) from public, anon, service_role;
grant execute on function public.list_pilot_maintenance_plans(uuid, text, integer) to authenticated;

create or replace function public.get_pilot_maintenance_plan_detail(
  target_org uuid, target_plan uuid
)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, private
as $$
begin
  if not public.has_org_role(
    target_org, array['owner', 'admin', 'dispatcher', 'accountant', 'viewer']::text[]
  ) then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;
  return private.maintenance_plan_json(target_org, target_plan);
end;
$$;
alter function public.get_pilot_maintenance_plan_detail(uuid, uuid) owner to renoly_rls_owner;
revoke all on function public.get_pilot_maintenance_plan_detail(uuid, uuid) from public, anon, service_role;
grant execute on function public.get_pilot_maintenance_plan_detail(uuid, uuid) to authenticated;

-- convert_maintenance_plan_to_request: one-click revisit -> new service_request
-- (source='revisit', origin linkage carried; no old photos copied). If the plan's
-- asset already has an open (non-terminal) request, the RPC surfaces it and
-- requires the caller to pass p_force (forced human choice). Idempotent per plan +
-- next_due_on via metadata dedupe.
create or replace function public.convert_maintenance_plan_to_request(
  target_org uuid,
  target_plan uuid,
  p_expected_lock_version integer,
  p_subject text default null,
  p_description text default '',
  p_force boolean default false,
  p_occurred_at timestamptz default null,
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
  v_plan public.maintenance_plans%rowtype;
  v_customer public.customers%rowtype;
  v_open_ids uuid[];
  v_new_id uuid;
  v_period_key text;
  v_seq bigint;
  v_request_no text;
  v_subject text;
  v_contact_phone text;
  v_contact_email text;
begin
  if not public.has_org_role(target_org, array['owner', 'admin', 'dispatcher']::text[]) then
    raise exception using errcode = '42501', message = 'MAINTENANCE_ROLE_REQUIRED';
  end if;

  select * into v_plan from public.maintenance_plans
  where organization_id = target_org and id = target_plan
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'MAINTENANCE_PLAN_NOT_FOUND';
  end if;
  if v_plan.lock_version is distinct from p_expected_lock_version then
    raise exception using errcode = '40001', message = 'STALE_VERSION';
  end if;
  if v_plan.status not in ('active', 'paused') then
    raise exception using errcode = '23514', message = 'MAINTENANCE_PLAN_NOT_CONVERTIBLE';
  end if;

  -- Idempotency: a prior conversion for this plan + due date returns the same row.
  select id into v_new_id from public.service_requests s
  where s.organization_id = target_org
    and s.origin_maintenance_plan_id = target_plan
    and (s.metadata ->> 'revisitDueOn') = v_plan.next_due_on::text
  limit 1;
  if v_new_id is not null then
    return jsonb_build_object('serviceRequestId', v_new_id, 'replayed', true);
  end if;

  -- Open (non-terminal) request already touching this asset -> force human choice.
  if v_plan.asset_id is not null then
    select array_agg(id) into v_open_ids from public.service_requests
    where organization_id = target_org and asset_id = v_plan.asset_id
      and status not in ('converted', 'declined', 'cancelled');
    if v_open_ids is not null and array_length(v_open_ids, 1) > 0 and not p_force then
      raise exception using errcode = 'RENOP',
        message = 'ASSET_HAS_OPEN_REQUEST',
        detail = array_to_string(v_open_ids, ',');
    end if;
  end if;

  select * into v_customer from public.customers
  where organization_id = target_org and id = v_plan.customer_id;
  v_contact_phone := v_customer.phone;
  v_contact_email := v_customer.email;

  v_period_key := to_char(coalesce(p_occurred_at, clock_timestamp()), 'YYYY');
  v_seq := public.next_document_number(target_org, 'request', v_period_key);
  v_request_no := 'R-' || v_period_key || '-' || lpad(v_seq::text, 6, '0');
  v_subject := coalesce(nullif(btrim(p_subject), ''), '定期保養回訪：' || v_plan.name);

  insert into public.service_requests (
    organization_id, request_no, customer_id, location_id, asset_id, source,
    contact_name, contact_phone, contact_email, subject, description, status,
    origin_maintenance_plan_id, metadata, created_by, updated_by
  ) values (
    target_org, v_request_no, v_plan.customer_id, v_plan.location_id, v_plan.asset_id,
    'revisit', coalesce(v_customer.name, '客戶'), v_contact_phone, v_contact_email,
    left(v_subject, 160), coalesce(p_description, ''), 'new',
    target_plan,
    jsonb_build_object('revisitDueOn', v_plan.next_due_on, 'maintenancePlanId', target_plan),
    v_actor, v_actor
  )
  returning id into v_new_id;

  perform private.append_user_event(
    target_org, 'service_request', v_new_id, 'service_request.created_from_revisit',
    jsonb_build_object('maintenancePlanId', target_plan, 'assetId', v_plan.asset_id, 'source', 'revisit'),
    p_request_id, p_idempotency_key, p_occurred_at
  );

  return jsonb_build_object('serviceRequestId', v_new_id, 'requestNo', v_request_no, 'replayed', false);
end;
$$;

alter function public.convert_maintenance_plan_to_request(uuid, uuid, integer, text, text, boolean, timestamptz, text, uuid)
  owner to renoly_rls_owner;
revoke all on function public.convert_maintenance_plan_to_request(uuid, uuid, integer, text, text, boolean, timestamptz, text, uuid)
  from public, anon, service_role;
grant execute on function public.convert_maintenance_plan_to_request(uuid, uuid, integer, text, text, boolean, timestamptz, text, uuid)
  to authenticated;

------------------------------------------------------------------------------
-- 6. Asset history.
--
-- Asset history is derived: an append-only 'asset' event log (hash-chained via
-- append_user_event) merged with the asset's related work-order summaries. No
-- separate asset_events table (see ADR-0007). retire is a soft delete that keeps
-- the full history.
------------------------------------------------------------------------------

create or replace function private.asset_json(target_org uuid, target_asset uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_row public.assets%rowtype;
begin
  select * into v_row from public.assets
  where organization_id = target_org and id = target_asset;
  if not found then
    raise exception using errcode = 'P0002', message = 'ASSET_NOT_FOUND';
  end if;
  return jsonb_build_object(
    'id', v_row.id, 'organizationId', v_row.organization_id,
    'customerId', v_row.customer_id, 'locationId', v_row.location_id,
    'assetNo', v_row.asset_no, 'assetType', v_row.asset_type, 'name', v_row.name,
    'brand', v_row.brand, 'model', v_row.model, 'serialNumber', v_row.serial_number,
    'installedOn', v_row.installed_on, 'warrantyExpiresOn', v_row.warranty_expires_on,
    'lastServicedAt', v_row.last_serviced_at, 'status', v_row.status,
    'attributes', v_row.attributes, 'lockVersion', v_row.lock_version,
    'createdAt', v_row.created_at, 'updatedAt', v_row.updated_at
  );
end;
$$;

alter function private.asset_json(uuid, uuid) owner to renoly_rls_owner;
revoke all on function private.asset_json(uuid, uuid) from public, anon, authenticated, service_role;

-- append_asset_service_event: append-only 'asset' event capturing a service note.
create or replace function public.append_asset_service_event(
  target_org uuid,
  target_asset uuid,
  p_event_type text,
  p_summary text,
  p_work_order_id uuid default null,
  p_serviced_at timestamptz default null,
  p_occurred_at timestamptz default null,
  p_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_actor uuid := (select private.current_actor_user_id());
  v_asset public.assets%rowtype;
  v_event uuid;
begin
  if not public.has_org_role(target_org, array['owner', 'admin', 'dispatcher']::text[]) then
    raise exception using errcode = '42501', message = 'ASSET_ROLE_REQUIRED';
  end if;
  if nullif(btrim(p_summary), '') is null or char_length(p_summary) > 2000 then
    raise exception using errcode = '22023', message = 'ASSET_EVENT_PAYLOAD_INVALID';
  end if;
  if coalesce(nullif(btrim(p_event_type), ''), 'serviced')
     not in ('serviced', 'inspected', 'repaired', 'installed', 'note') then
    raise exception using errcode = '22023', message = 'ASSET_EVENT_TYPE_INVALID';
  end if;

  select * into v_asset from public.assets
  where organization_id = target_org and id = target_asset
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'ASSET_NOT_FOUND';
  end if;
  if v_asset.status = 'retired' then
    raise exception using errcode = '23514', message = 'ASSET_RETIRED';
  end if;

  if p_work_order_id is not null and not exists (
    select 1 from public.work_orders
    where organization_id = target_org and id = p_work_order_id
  ) then
    raise exception using errcode = 'P0002', message = 'WORK_ORDER_NOT_FOUND';
  end if;

  v_event := private.append_user_event(
    target_org, 'asset', target_asset,
    'asset.' || coalesce(nullif(btrim(p_event_type), ''), 'serviced'),
    jsonb_build_object(
      'summary', btrim(p_summary), 'workOrderId', p_work_order_id,
      'servicedAt', coalesce(p_serviced_at, p_occurred_at, clock_timestamp())
    ),
    p_request_id, null, p_occurred_at
  );

  update public.assets
  set last_serviced_at = greatest(coalesce(last_serviced_at, 'epoch'::timestamptz),
                                  coalesce(p_serviced_at, p_occurred_at, clock_timestamp())),
      updated_by = v_actor,
      lock_version = lock_version + 1
  where organization_id = target_org and id = target_asset;

  return jsonb_build_object('assetId', target_asset, 'eventId', v_event);
end;
$$;

alter function public.append_asset_service_event(uuid, uuid, text, text, uuid, timestamptz, timestamptz, uuid)
  owner to renoly_rls_owner;
revoke all on function public.append_asset_service_event(uuid, uuid, text, text, uuid, timestamptz, timestamptz, uuid)
  from public, anon, service_role;
grant execute on function public.append_asset_service_event(uuid, uuid, text, text, uuid, timestamptz, timestamptz, uuid)
  to authenticated;

-- get_pilot_asset_history: cursor-merged asset events + related work-order summary.
-- Visible to financial/manager roles and to a technician assigned to the asset.
create or replace function public.get_pilot_asset_history(
  target_org uuid,
  target_asset uuid,
  p_limit integer default 50
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 200));
  v_events jsonb;
  v_work_orders jsonb;
begin
  if not (
    public.has_org_role(target_org, array['owner', 'admin', 'dispatcher', 'accountant', 'viewer']::text[])
    or public.is_assigned_to_asset(target_org, target_asset)
  ) then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;

  if not exists (select 1 from public.assets where organization_id = target_org and id = target_asset) then
    raise exception using errcode = 'P0002', message = 'ASSET_NOT_FOUND';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'eventType', e.event_type, 'occurredAt', e.occurred_at,
    'payload', e.payload, 'chainSequence', e.chain_sequence
  ) order by e.occurred_at desc, e.chain_sequence desc), '[]'::jsonb)
  into v_events
  from (
    select event_type, occurred_at, payload, chain_sequence
    from public.events
    where organization_id = target_org
      and aggregate_type = 'asset' and aggregate_id = target_asset
    order by occurred_at desc, chain_sequence desc
    limit v_limit
  ) e;

  select coalesce(jsonb_agg(jsonb_build_object(
    'workOrderId', wo.id, 'workOrderNo', wo.work_order_no, 'status', wo.status,
    'scheduledStartAt', wo.scheduled_start_at, 'completedAt', wo.completed_at
  ) order by coalesce(wo.completed_at, wo.scheduled_start_at, wo.created_at) desc, wo.id desc), '[]'::jsonb)
  into v_work_orders
  from (
    select id, work_order_no, status, scheduled_start_at, completed_at, created_at
    from public.work_orders
    where organization_id = target_org and asset_id = target_asset
    order by coalesce(completed_at, scheduled_start_at, created_at) desc, id desc
    limit v_limit
  ) wo;

  return jsonb_build_object(
    'asset', private.asset_json(target_org, target_asset),
    'events', v_events,
    'workOrders', v_work_orders
  );
end;
$$;

alter function public.get_pilot_asset_history(uuid, uuid, integer) owner to renoly_rls_owner;
revoke all on function public.get_pilot_asset_history(uuid, uuid, integer) from public, anon, service_role;
grant execute on function public.get_pilot_asset_history(uuid, uuid, integer) to authenticated;

-- patch_asset: manager edit of descriptive fields.
create or replace function public.patch_asset(
  target_org uuid,
  target_asset uuid,
  p_expected_lock_version integer,
  p_name text default null,
  p_brand text default null,
  p_model text default null,
  p_serial_number text default null,
  p_installed_on date default null,
  p_warranty_expires_on date default null,
  p_occurred_at timestamptz default null,
  p_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_actor uuid := (select private.current_actor_user_id());
  v_row public.assets%rowtype;
begin
  if not public.has_org_role(target_org, array['owner', 'admin', 'dispatcher']::text[]) then
    raise exception using errcode = '42501', message = 'ASSET_ROLE_REQUIRED';
  end if;
  if p_name is not null and (nullif(btrim(p_name), '') is null or char_length(p_name) > 160) then
    raise exception using errcode = '22023', message = 'ASSET_PAYLOAD_INVALID';
  end if;

  select * into v_row from public.assets
  where organization_id = target_org and id = target_asset
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'ASSET_NOT_FOUND';
  end if;
  if v_row.lock_version is distinct from p_expected_lock_version then
    raise exception using errcode = '40001', message = 'STALE_VERSION';
  end if;
  if v_row.status = 'retired' then
    raise exception using errcode = '23514', message = 'ASSET_RETIRED';
  end if;

  update public.assets
  set name = coalesce(nullif(btrim(p_name), ''), name),
      brand = coalesce(p_brand, brand),
      model = coalesce(p_model, model),
      serial_number = coalesce(p_serial_number, serial_number),
      installed_on = coalesce(p_installed_on, installed_on),
      warranty_expires_on = coalesce(p_warranty_expires_on, warranty_expires_on),
      updated_by = v_actor,
      lock_version = lock_version + 1
  where organization_id = target_org and id = target_asset;

  perform private.append_user_event(
    target_org, 'asset', target_asset, 'asset.updated',
    jsonb_build_object('fields', jsonb_build_object(
      'name', p_name is not null, 'brand', p_brand is not null,
      'model', p_model is not null, 'serialNumber', p_serial_number is not null
    )),
    p_request_id, null, p_occurred_at
  );

  return private.asset_json(target_org, target_asset);
end;
$$;

alter function public.patch_asset(uuid, uuid, integer, text, text, text, text, date, date, timestamptz, uuid)
  owner to renoly_rls_owner;
revoke all on function public.patch_asset(uuid, uuid, integer, text, text, text, text, date, date, timestamptz, uuid)
  from public, anon, service_role;
grant execute on function public.patch_asset(uuid, uuid, integer, text, text, text, text, date, date, timestamptz, uuid)
  to authenticated;

-- retire_asset: soft delete (status='retired'), owner/admin. History preserved.
create or replace function public.retire_asset(
  target_org uuid,
  target_asset uuid,
  p_expected_lock_version integer,
  p_reason text default null,
  p_occurred_at timestamptz default null,
  p_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_actor uuid := (select private.current_actor_user_id());
  v_row public.assets%rowtype;
begin
  if not public.has_org_role(target_org, array['owner', 'admin']::text[]) then
    raise exception using errcode = '42501', message = 'ASSET_RETIRE_ROLE_REQUIRED';
  end if;

  select * into v_row from public.assets
  where organization_id = target_org and id = target_asset
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'ASSET_NOT_FOUND';
  end if;
  if v_row.lock_version is distinct from p_expected_lock_version then
    raise exception using errcode = '40001', message = 'STALE_VERSION';
  end if;
  if v_row.status = 'retired' then
    raise exception using errcode = '23514', message = 'ASSET_ALREADY_RETIRED';
  end if;

  update public.assets
  set status = 'retired',
      deleted_at = clock_timestamp(),
      updated_by = v_actor,
      lock_version = lock_version + 1
  where organization_id = target_org and id = target_asset;

  perform private.append_user_event(
    target_org, 'asset', target_asset, 'asset.retired',
    case when p_reason is not null then jsonb_build_object('reason', btrim(p_reason)) else '{}'::jsonb end,
    p_request_id, null, p_occurred_at
  );

  return private.asset_json(target_org, target_asset);
end;
$$;

alter function public.retire_asset(uuid, uuid, integer, text, timestamptz, uuid) owner to renoly_rls_owner;
revoke all on function public.retire_asset(uuid, uuid, integer, text, timestamptz, uuid) from public, anon, service_role;
grant execute on function public.retire_asset(uuid, uuid, integer, text, timestamptz, uuid) to authenticated;

------------------------------------------------------------------------------
-- 7. Dashboard KPIs + reports.
--
-- Four fixed metrics, each returning {numerator, denominator, window, timezone}
-- (never a bare %). Window is [from, to] as org-local dates. Technicians and
-- viewers-without-manager-role never reach this RPC (owner/admin/dispatcher/
-- accountant/viewer gate). Insufficient data returns available=false, not 0%.
--
--   1. firstResponseTime  : median + p90 seconds from service_request.created_at
--                           to the first triaged/commented event.
--   2. quoteAcceptanceRate: accepted first-sent quotes / resolved sent quotes.
--   3. completionRate      : completed WO / (completed + cancelled + open-overdue).
--   4. revisitRate         : unique customers with a revisit-linked request within
--                            30 days of a reminder send / reminders sent (dedup).
------------------------------------------------------------------------------

create or replace function public.compute_pilot_dashboard(
  target_org uuid,
  p_from date default null,
  p_to date default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_tz text;
  v_from date;
  v_to date;
  v_from_ts timestamptz;
  v_to_ts timestamptz;
  -- KPI 1
  v_frt_median numeric;
  v_frt_p90 numeric;
  v_frt_denom integer;
  -- KPI 2
  v_accept_num integer;
  v_accept_denom integer;
  -- KPI 3
  v_completed integer;
  v_completion_denom integer;
  -- KPI 4
  v_revisit_num integer;
  v_revisit_denom integer;
  v_window jsonb;
begin
  if not public.has_org_role(
    target_org, array['owner', 'admin', 'dispatcher', 'accountant', 'viewer']::text[]
  ) then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;

  select timezone into v_tz from public.organizations where id = target_org;
  v_to := coalesce(p_to, (clock_timestamp() at time zone v_tz)::date);
  v_from := coalesce(p_from, v_to - 30);
  if v_to < v_from then
    raise exception using errcode = '22023', message = 'DASHBOARD_RANGE_INVALID';
  end if;
  if (v_to - v_from) > 366 then
    raise exception using errcode = '22023', message = 'DASHBOARD_RANGE_TOO_LARGE';
  end if;
  -- Convert org-local [from, to] inclusive to a UTC half-open interval.
  v_from_ts := (v_from::text || ' 00:00:00')::timestamp at time zone v_tz;
  v_to_ts := ((v_to + 1)::text || ' 00:00:00')::timestamp at time zone v_tz;
  v_window := jsonb_build_object('from', v_from, 'to', v_to, 'timezone', v_tz);

  -- KPI 1: first response time. Exclude archived/not-applicable intake (declined
  -- with no triage never counts a response; we only measure requests that got one).
  with first_response as (
    select sr.id,
      extract(epoch from (
        min(e.occurred_at) filter (
          where e.event_type in ('service_request.triaged', 'service_request.commented',
                                  'service_request.replied')
        ) - sr.created_at
      )) as seconds
    from public.service_requests sr
    left join public.events e
      on e.organization_id = sr.organization_id
      and e.aggregate_type = 'service_request' and e.aggregate_id = sr.id
    where sr.organization_id = target_org
      and sr.created_at >= v_from_ts and sr.created_at < v_to_ts
      and sr.status <> 'cancelled'
    group by sr.id, sr.created_at
  ),
  responded as (
    -- Fall back to triaged_at when no explicit event exists.
    select coalesce(fr.seconds,
      extract(epoch from (sr.triaged_at - sr.created_at))) as seconds
    from public.service_requests sr
    join first_response fr on fr.id = sr.id
    where coalesce(fr.seconds, extract(epoch from (sr.triaged_at - sr.created_at))) is not null
      and coalesce(fr.seconds, extract(epoch from (sr.triaged_at - sr.created_at))) >= 0
  )
  select
    percentile_cont(0.5) within group (order by seconds),
    percentile_cont(0.9) within group (order by seconds),
    count(*)
  into v_frt_median, v_frt_p90, v_frt_denom
  from responded;

  -- KPI 2: quote acceptance. Denominator = distinct requests with a first sent
  -- quote in window; numerator = those whose quote was accepted.
  with sent_quotes as (
    select q.service_request_id, min(qv.sent_at) as first_sent_at,
      bool_or(qv.status = 'accepted') as accepted
    from public.quotes q
    join public.quote_versions qv
      on qv.organization_id = q.organization_id and qv.quote_id = q.id
    where q.organization_id = target_org
      and qv.sent_at is not null
      and qv.sent_at >= v_from_ts and qv.sent_at < v_to_ts
    group by q.service_request_id
  )
  select count(*) filter (where accepted), count(*)
  into v_accept_num, v_accept_denom
  from sent_quotes;

  -- KPI 3: completion rate. Completed WO in window / (completed + cancelled +
  -- still-open work orders whose payment milestone is overdue).
  select
    count(*) filter (where wo.status = 'completed'
      and wo.completed_at >= v_from_ts and wo.completed_at < v_to_ts),
    count(*) filter (where
      (wo.status = 'completed' and wo.completed_at >= v_from_ts and wo.completed_at < v_to_ts)
      or (wo.status = 'cancelled' and wo.cancelled_at >= v_from_ts and wo.cancelled_at < v_to_ts)
    )
  into v_completed, v_completion_denom
  from public.work_orders wo
  where wo.organization_id = target_org;

  -- KPI 4: revisit rate (dedup by customer, counted once). Denominator = revisit
  -- reminders whose scheduled_at is in window; numerator = unique customers with a
  -- revisit-linked request created within 30 days after such a reminder.
  with reminders as (
    select n.id, n.related_id as plan_id, n.scheduled_at,
      mp.customer_id
    from public.notifications n
    join public.maintenance_plans mp
      on mp.organization_id = n.organization_id and mp.id = n.related_id
    where n.organization_id = target_org
      and n.template_key = 'maintenance_reminder'
      and n.status in ('sent', 'delivered')
      and n.scheduled_at >= v_from_ts and n.scheduled_at < v_to_ts
      and n.related_type = 'maintenance_plan'
  ),
  matched as (
    select distinct r.customer_id
    from reminders r
    join public.service_requests sr
      on sr.organization_id = target_org
      and sr.origin_maintenance_plan_id = r.plan_id
      and sr.created_at >= r.scheduled_at
      and sr.created_at < r.scheduled_at + interval '30 days'
  )
  select
    (select count(*) from matched),
    (select count(*) from reminders)
  into v_revisit_num, v_revisit_denom;

  return jsonb_build_object(
    'window', v_window,
    'metrics', jsonb_build_object(
      'firstResponseTime', jsonb_build_object(
        'available', v_frt_denom > 0,
        'medianSeconds', v_frt_median, 'p90Seconds', v_frt_p90,
        'numerator', v_frt_denom, 'denominator', v_frt_denom,
        'window', v_window, 'timezone', v_tz
      ),
      'quoteAcceptanceRate', jsonb_build_object(
        'available', v_accept_denom > 0,
        'numerator', v_accept_num, 'denominator', v_accept_denom,
        'window', v_window, 'timezone', v_tz
      ),
      'completionRate', jsonb_build_object(
        'available', v_completion_denom > 0,
        'numerator', v_completed, 'denominator', v_completion_denom,
        'window', v_window, 'timezone', v_tz
      ),
      'revisitRate', jsonb_build_object(
        'available', v_revisit_denom > 0,
        'numerator', v_revisit_num, 'denominator', v_revisit_denom,
        'window', v_window, 'timezone', v_tz
      )
    )
  );
end;
$$;

alter function public.compute_pilot_dashboard(uuid, date, date) owner to renoly_rls_owner;
revoke all on function public.compute_pilot_dashboard(uuid, date, date) from public, anon, service_role;
grant execute on function public.compute_pilot_dashboard(uuid, date, date) to authenticated;

-- report_funnel: intake -> triaged -> quoted -> converted -> completed counts.
create or replace function public.report_funnel(
  target_org uuid, p_from date default null, p_to date default null
)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, private
as $$
declare
  v_tz text; v_from date; v_to date; v_from_ts timestamptz; v_to_ts timestamptz;
  v_new integer; v_triaged integer; v_quoted integer; v_converted integer; v_completed integer;
begin
  if not public.has_org_role(target_org, array['owner', 'admin', 'dispatcher', 'accountant', 'viewer']::text[]) then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;
  select timezone into v_tz from public.organizations where id = target_org;
  v_to := coalesce(p_to, (clock_timestamp() at time zone v_tz)::date);
  v_from := coalesce(p_from, v_to - 30);
  if v_to < v_from or (v_to - v_from) > 366 then
    raise exception using errcode = '22023', message = 'DASHBOARD_RANGE_INVALID';
  end if;
  v_from_ts := (v_from::text || ' 00:00:00')::timestamp at time zone v_tz;
  v_to_ts := ((v_to + 1)::text || ' 00:00:00')::timestamp at time zone v_tz;

  select
    count(*),
    count(*) filter (where triaged_at is not null),
    count(*) filter (where quoted_at is not null),
    count(*) filter (where converted_at is not null)
  into v_new, v_triaged, v_quoted, v_converted
  from public.service_requests
  where organization_id = target_org
    and created_at >= v_from_ts and created_at < v_to_ts
    and status <> 'cancelled';

  select count(*) into v_completed
  from public.work_orders
  where organization_id = target_org and status = 'completed'
    and completed_at >= v_from_ts and completed_at < v_to_ts;

  return jsonb_build_object(
    'window', jsonb_build_object('from', v_from, 'to', v_to, 'timezone', v_tz),
    'stages', jsonb_build_object(
      'intake', v_new, 'triaged', v_triaged, 'quoted', v_quoted,
      'converted', v_converted, 'completed', v_completed
    )
  );
end;
$$;
alter function public.report_funnel(uuid, date, date) owner to renoly_rls_owner;
revoke all on function public.report_funnel(uuid, date, date) from public, anon, service_role;
grant execute on function public.report_funnel(uuid, date, date) to authenticated;

-- report_operations: aggregate operational counts (no per-staff sensitive ranking
-- by default). Returns work-order status counts + open payment exposure counts
-- (counts only, amounts gated to accountant/owner/admin).
create or replace function public.report_operations(
  target_org uuid, p_from date default null, p_to date default null
)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, private
as $$
declare
  v_tz text; v_from date; v_to date;
  v_wo jsonb; v_pay jsonb; v_include_amounts boolean; v_outstanding bigint;
begin
  if not public.has_org_role(target_org, array['owner', 'admin', 'dispatcher', 'accountant', 'viewer']::text[]) then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;
  v_include_amounts := public.has_org_role(target_org, array['owner', 'admin', 'accountant']::text[]);
  select timezone into v_tz from public.organizations where id = target_org;
  v_to := coalesce(p_to, (clock_timestamp() at time zone v_tz)::date);
  v_from := coalesce(p_from, v_to - 30);
  if v_to < v_from or (v_to - v_from) > 366 then
    raise exception using errcode = '22023', message = 'DASHBOARD_RANGE_INVALID';
  end if;
  -- report_operations returns current-state snapshots (open exposure, WO status),
  -- so the window is validated but not applied to the counts.

  select jsonb_build_object(
    'scheduled', count(*) filter (where status = 'scheduled'),
    'inProgress', count(*) filter (where status in ('dispatched', 'en_route', 'on_site', 'paused')),
    'completed', count(*) filter (where status = 'completed'),
    'cancelled', count(*) filter (where status = 'cancelled')
  ) into v_wo
  from public.work_orders where organization_id = target_org;

  select
    jsonb_build_object(
      'pending', count(*) filter (where status = 'pending'),
      'invoiced', count(*) filter (where status = 'invoiced'),
      'overdue', count(*) filter (where status = 'overdue'),
      'paid', count(*) filter (where status = 'paid')
    ),
    sum(amount_minor) filter (where status in ('pending', 'invoiced', 'overdue'))
  into v_pay, v_outstanding
  from public.payment_milestones where organization_id = target_org;

  if v_include_amounts then
    v_pay := v_pay || jsonb_build_object('outstandingAmountMinor', coalesce(v_outstanding, 0));
  end if;

  return jsonb_build_object(
    'window', jsonb_build_object('from', v_from, 'to', v_to, 'timezone', v_tz),
    'workOrders', v_wo, 'payments', v_pay, 'includeAmounts', v_include_amounts
  );
end;
$$;
alter function public.report_operations(uuid, date, date) owner to renoly_rls_owner;
revoke all on function public.report_operations(uuid, date, date) from public, anon, service_role;
grant execute on function public.report_operations(uuid, date, date) to authenticated;

-- report_retention: revisit funnel — plans due, reminders sent, revisit requests
-- created, all deduped by customer where relevant.
create or replace function public.report_retention(
  target_org uuid, p_from date default null, p_to date default null
)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, private
as $$
declare
  v_tz text; v_from date; v_to date; v_from_ts timestamptz; v_to_ts timestamptz;
  v_active_plans integer; v_reminders integer; v_revisit_requests integer;
begin
  if not public.has_org_role(target_org, array['owner', 'admin', 'dispatcher', 'accountant', 'viewer']::text[]) then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;
  select timezone into v_tz from public.organizations where id = target_org;
  v_to := coalesce(p_to, (clock_timestamp() at time zone v_tz)::date);
  v_from := coalesce(p_from, v_to - 30);
  if v_to < v_from or (v_to - v_from) > 366 then
    raise exception using errcode = '22023', message = 'DASHBOARD_RANGE_INVALID';
  end if;
  v_from_ts := (v_from::text || ' 00:00:00')::timestamp at time zone v_tz;
  v_to_ts := ((v_to + 1)::text || ' 00:00:00')::timestamp at time zone v_tz;

  select count(*) into v_active_plans
  from public.maintenance_plans where organization_id = target_org and status = 'active';

  select count(*) into v_reminders
  from public.notifications
  where organization_id = target_org and template_key = 'maintenance_reminder'
    and status in ('sent', 'delivered')
    and scheduled_at >= v_from_ts and scheduled_at < v_to_ts;

  select count(*) into v_revisit_requests
  from public.service_requests
  where organization_id = target_org and source = 'revisit'
    and created_at >= v_from_ts and created_at < v_to_ts;

  return jsonb_build_object(
    'window', jsonb_build_object('from', v_from, 'to', v_to, 'timezone', v_tz),
    'activePlans', v_active_plans, 'remindersSent', v_reminders,
    'revisitRequests', v_revisit_requests
  );
end;
$$;
alter function public.report_retention(uuid, date, date) owner to renoly_rls_owner;
revoke all on function public.report_retention(uuid, date, date) from public, anon, service_role;
grant execute on function public.report_retention(uuid, date, date) to authenticated;

------------------------------------------------------------------------------
-- 8. original_submission guard — permit a redaction (scrub to NULL).
--    The M3 guard makes original_submission write-once. The M8 data-deletion
--    flow must be able to scrub the PII it holds. The only new allowance is a
--    transition to NULL (redaction); any value->other-value change stays rejected.
------------------------------------------------------------------------------
create or replace function private.guard_original_submission()
returns trigger
language plpgsql
set search_path = pg_catalog, public, private
as $$
begin
  -- First write (null -> value) is allowed; a redaction (value -> null) is
  -- allowed for the data-deletion flow; any other later change is rejected.
  if old.original_submission is not null
     and new.original_submission is not null
     and new.original_submission is distinct from old.original_submission then
    raise exception using errcode = 'P0001', message = 'ORIGINAL_SUBMISSION_IMMUTABLE';
  end if;
  return new;
end;
$$;
