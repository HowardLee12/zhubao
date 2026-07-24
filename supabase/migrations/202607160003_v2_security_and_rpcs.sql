-- Renoly v2 RLS, immutable transaction guards and Phase 1 transaction RPCs.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'renoly_rls_owner') then
    create role renoly_rls_owner nologin bypassrls;
  end if;
end
$$;

alter role renoly_rls_owner nologin bypassrls;

-- PostgreSQL only permits changing an object's owner to a role the migration
-- executor can SET ROLE to. Supabase migrations run as a CREATEROLE account,
-- but creating the role does not implicitly grant that membership.
do $$
begin
  execute format('grant renoly_rls_owner to %I', current_user);
end
$$;

grant usage on schema public, private, extensions to renoly_rls_owner;
grant create on schema public, private to renoly_rls_owner;
grant select, insert, update, delete on all tables in schema public to renoly_rls_owner;
grant select, insert, update, delete on private.line_channel_credentials to renoly_rls_owner;

create or replace function private.current_actor_user_id()
returns uuid
language sql
stable
set search_path = pg_catalog
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  )::uuid;
$$;

alter function private.current_actor_user_id() owner to renoly_rls_owner;
revoke all on function private.current_actor_user_id() from public, anon, authenticated;

create or replace function public.is_active_member(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.memberships m
    join public.organizations o on o.id = m.organization_id
    where m.organization_id = target_org
      and m.user_id = (select private.current_actor_user_id())
      and m.status = 'active'
      and o.status = 'active'
  );
$$;

alter function public.is_active_member(uuid) owner to renoly_rls_owner;
revoke all on function public.is_active_member(uuid) from public;
grant execute on function public.is_active_member(uuid) to authenticated;

create or replace function public.has_org_role(target_org uuid, allowed_roles text[])
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.memberships m
    join public.organizations o on o.id = m.organization_id
    where m.organization_id = target_org
      and m.user_id = (select private.current_actor_user_id())
      and m.status = 'active'
      and m.role = any(allowed_roles)
      and o.status = 'active'
  );
$$;

alter function public.has_org_role(uuid, text[]) owner to renoly_rls_owner;
revoke all on function public.has_org_role(uuid, text[]) from public;
grant execute on function public.has_org_role(uuid, text[]) to authenticated;

create or replace function public.is_current_membership(target_org uuid, target_membership uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.memberships m
    join public.organizations o on o.id = m.organization_id
    where m.organization_id = target_org
      and m.id = target_membership
      and m.user_id = (select private.current_actor_user_id())
      and m.status = 'active'
      and o.status = 'active'
  );
$$;

alter function public.is_current_membership(uuid, uuid) owner to renoly_rls_owner;
revoke all on function public.is_current_membership(uuid, uuid) from public;
grant execute on function public.is_current_membership(uuid, uuid) to authenticated;

create or replace function public.is_assigned_to_work_order(target_org uuid, target_work_order uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.assignments a
    join public.memberships m
      on m.organization_id = a.organization_id
     and m.id = a.membership_id
    join public.organizations o on o.id = a.organization_id
    where a.organization_id = target_org
      and a.work_order_id = target_work_order
      and a.status in ('assigned', 'accepted', 'checked_in')
      and m.user_id = (select private.current_actor_user_id())
      and m.status = 'active'
      and o.status = 'active'
  );
$$;

alter function public.is_assigned_to_work_order(uuid, uuid) owner to renoly_rls_owner;
revoke all on function public.is_assigned_to_work_order(uuid, uuid) from public;
grant execute on function public.is_assigned_to_work_order(uuid, uuid) to authenticated;

create or replace function public.has_work_order_assignment_history(target_org uuid, target_work_order uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.assignments a
    join public.memberships m
      on m.organization_id = a.organization_id
     and m.id = a.membership_id
    join public.organizations o on o.id = a.organization_id
    where a.organization_id = target_org
      and a.work_order_id = target_work_order
      and a.status in ('assigned', 'accepted', 'checked_in', 'completed')
      and m.user_id = (select private.current_actor_user_id())
      and m.status = 'active'
      and o.status = 'active'
  );
$$;

alter function public.has_work_order_assignment_history(uuid, uuid) owner to renoly_rls_owner;
revoke all on function public.has_work_order_assignment_history(uuid, uuid) from public;
grant execute on function public.has_work_order_assignment_history(uuid, uuid) to authenticated;

create or replace function public.is_assigned_to_customer(target_org uuid, target_customer uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.work_orders wo
    where wo.organization_id = target_org
      and wo.customer_id = target_customer
      and wo.status <> 'cancelled'
      and public.is_assigned_to_work_order(target_org, wo.id)
  );
$$;

alter function public.is_assigned_to_customer(uuid, uuid) owner to renoly_rls_owner;
revoke all on function public.is_assigned_to_customer(uuid, uuid) from public;
grant execute on function public.is_assigned_to_customer(uuid, uuid) to authenticated;

create or replace function public.is_assigned_to_location(target_org uuid, target_location uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.work_orders wo
    where wo.organization_id = target_org
      and wo.location_id = target_location
      and wo.status <> 'cancelled'
      and public.is_assigned_to_work_order(target_org, wo.id)
  );
$$;

alter function public.is_assigned_to_location(uuid, uuid) owner to renoly_rls_owner;
revoke all on function public.is_assigned_to_location(uuid, uuid) from public;
grant execute on function public.is_assigned_to_location(uuid, uuid) to authenticated;

create or replace function public.is_assigned_to_asset(target_org uuid, target_asset uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.work_orders wo
    where wo.organization_id = target_org
      and wo.asset_id = target_asset
      and wo.status <> 'cancelled'
      and public.is_assigned_to_work_order(target_org, wo.id)
  );
$$;

alter function public.is_assigned_to_asset(uuid, uuid) owner to renoly_rls_owner;
revoke all on function public.is_assigned_to_asset(uuid, uuid) from public;
grant execute on function public.is_assigned_to_asset(uuid, uuid) to authenticated;

create or replace function public.is_assigned_to_service_request(target_org uuid, target_request uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.work_orders wo
    where wo.organization_id = target_org
      and wo.service_request_id = target_request
      and wo.status <> 'cancelled'
      and public.is_assigned_to_work_order(target_org, wo.id)
  );
$$;

alter function public.is_assigned_to_service_request(uuid, uuid) owner to renoly_rls_owner;
revoke all on function public.is_assigned_to_service_request(uuid, uuid) from public;
grant execute on function public.is_assigned_to_service_request(uuid, uuid) to authenticated;

create or replace function public.is_assigned_to_project(target_org uuid, target_project uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.work_orders wo
    where wo.organization_id = target_org
      and wo.project_id = target_project
      and wo.status <> 'cancelled'
      and public.is_assigned_to_work_order(target_org, wo.id)
  );
$$;

alter function public.is_assigned_to_project(uuid, uuid) owner to renoly_rls_owner;
revoke all on function public.is_assigned_to_project(uuid, uuid) from public;
grant execute on function public.is_assigned_to_project(uuid, uuid) to authenticated;

create or replace function private.protect_tenant_identity()
returns trigger
language plpgsql
set search_path = pg_catalog, public, private
as $$
begin
  if new.id is distinct from old.id
     or new.organization_id is distinct from old.organization_id
     or new.created_at is distinct from old.created_at then
    raise exception using errcode = 'P0001', message = 'IMMUTABLE_IDENTITY_FIELDS';
  end if;
  return new;
end;
$$;

revoke all on function private.protect_tenant_identity() from public, anon, authenticated;

create or replace function private.require_rpc_status_transition()
returns trigger
language plpgsql
set search_path = pg_catalog, public, private
as $$
begin
  if new.status is distinct from old.status and current_user <> 'renoly_rls_owner' then
    raise exception using errcode = 'P0001', message = 'STATUS_TRANSITION_REQUIRES_RPC';
  end if;
  return new;
end;
$$;

revoke all on function private.require_rpc_status_transition() from public, anon, authenticated;

create or replace function private.prevent_append_only_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public, private
as $$
begin
  raise exception using errcode = 'P0001', message = 'APPEND_ONLY_RECORD';
end;
$$;

revoke all on function private.prevent_append_only_mutation() from public, anon, authenticated;

create or replace function private.validate_assignment_member()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  if not exists (
    select 1
    from public.memberships m
    where m.organization_id = new.organization_id
      and m.id = new.membership_id
      and m.status = 'active'
      and m.role in ('owner', 'admin', 'dispatcher', 'technician')
  ) then
    raise exception using errcode = '23514', message = 'ASSIGNEE_NOT_ACTIVE';
  end if;
  return new;
end;
$$;

alter function private.validate_assignment_member() owner to renoly_rls_owner;
revoke all on function private.validate_assignment_member() from public, anon, authenticated;

create or replace function private.guard_membership_owner()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  actor_id uuid := (select private.current_actor_user_id());
  actor_is_owner boolean;
  removes_active_owner boolean;
begin
  -- Seed/migration/service administration has no user JWT and is handled outside
  -- the end-user membership API boundary.
  if actor_id is null then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  actor_is_owner := public.has_org_role(
    case when tg_op = 'DELETE' then old.organization_id else new.organization_id end,
    array['owner']::text[]
  );

  if (case when tg_op = 'DELETE' then old.role = 'owner' else old.role = 'owner' or new.role = 'owner' end)
     and not actor_is_owner then
    raise exception using errcode = '42501', message = 'OWNER_MEMBERSHIP_REQUIRES_OWNER';
  end if;

  removes_active_owner := old.role = 'owner' and old.status = 'active'
    and (
      tg_op = 'DELETE'
      or new.role <> 'owner'
      or new.status <> 'active'
    );

  if removes_active_owner and not exists (
    select 1 from public.memberships m
    where m.organization_id = old.organization_id
      and m.id <> old.id
      and m.role = 'owner'
      and m.status = 'active'
  ) then
    raise exception using errcode = '23514', message = 'LAST_ACTIVE_OWNER_REQUIRED';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

alter function private.guard_membership_owner() owner to renoly_rls_owner;
revoke all on function private.guard_membership_owner() from public, anon, authenticated;

create or replace function private.calculate_quote_item()
returns trigger
language plpgsql
set search_path = pg_catalog, public, private
as $$
begin
  new.subtotal_minor := round(new.quantity * new.unit_price_minor)::bigint;
  if new.discount_minor > new.subtotal_minor then
    raise exception using errcode = '23514', message = 'QUOTE_ITEM_DISCOUNT_EXCEEDS_SUBTOTAL';
  end if;
  new.tax_minor := round((new.subtotal_minor - new.discount_minor) * new.tax_rate)::bigint;
  new.total_minor := new.subtotal_minor - new.discount_minor + new.tax_minor;
  return new;
end;
$$;

revoke all on function private.calculate_quote_item() from public, anon, authenticated;

create or replace function private.guard_quote_version()
returns trigger
language plpgsql
set search_path = pg_catalog, public, private
as $$
declare
  content_changed boolean;
  approval_changed boolean;
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception using errcode = 'P0001', message = 'QUOTE_VERSION_IMMUTABLE';
    end if;
    return old;
  end if;

  content_changed := row(
    new.title, new.customer_notes, new.internal_notes, new.terms,
    new.subtotal_minor, new.discount_minor, new.tax_minor, new.total_minor, new.valid_until
  ) is distinct from row(
    old.title, old.customer_notes, old.internal_notes, old.terms,
    old.subtotal_minor, old.discount_minor, old.tax_minor, old.total_minor, old.valid_until
  );

  approval_changed := row(
    new.approval_status, new.submitted_for_approval_at, new.submitted_for_approval_by,
    new.approved_at, new.approved_by, new.approval_rejection_reason
  ) is distinct from row(
    old.approval_status, old.submitted_for_approval_at, old.submitted_for_approval_by,
    old.approved_at, old.approved_by, old.approval_rejection_reason
  );

  if old.status <> 'draft' and content_changed then
    raise exception using errcode = 'P0001', message = 'QUOTE_VERSION_IMMUTABLE';
  end if;

  if new.status is distinct from old.status and current_user <> 'renoly_rls_owner' then
    raise exception using errcode = 'P0001', message = 'STATUS_TRANSITION_REQUIRES_RPC';
  end if;

  if content_changed and current_user <> 'renoly_rls_owner' then
    new.approval_status := 'not_submitted';
    new.submitted_for_approval_at := null;
    new.submitted_for_approval_by := null;
    new.approved_at := null;
    new.approved_by := null;
    new.approval_rejection_reason := null;
  elsif approval_changed and current_user <> 'renoly_rls_owner' then
    raise exception using errcode = 'P0001', message = 'QUOTE_APPROVAL_REQUIRES_RPC';
  end if;

  if new.status <> 'draft' and new.approval_status <> 'approved' then
    raise exception using errcode = '23514', message = 'QUOTE_VERSION_NOT_APPROVED';
  end if;

  return new;
end;
$$;

revoke all on function private.guard_quote_version() from public, anon, authenticated;

create or replace function private.guard_quote_item_parent()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  parent_status text;
  target_version uuid;
begin
  target_version := case when tg_op = 'DELETE' then old.quote_version_id else new.quote_version_id end;
  select qv.status into parent_status
  from public.quote_versions qv
  where qv.organization_id = case when tg_op = 'DELETE' then old.organization_id else new.organization_id end
    and qv.id = target_version;

  if parent_status is distinct from 'draft' then
    raise exception using errcode = 'P0001', message = 'QUOTE_VERSION_IMMUTABLE';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

alter function private.guard_quote_item_parent() owner to renoly_rls_owner;
revoke all on function private.guard_quote_item_parent() from public, anon, authenticated;

create or replace function private.invalidate_quote_approval()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  target_org uuid;
  target_version uuid;
begin
  target_org := case when tg_op = 'DELETE' then old.organization_id else new.organization_id end;
  target_version := case when tg_op = 'DELETE' then old.quote_version_id else new.quote_version_id end;

  update public.quote_versions
  set approval_status = 'not_submitted',
      submitted_for_approval_at = null,
      submitted_for_approval_by = null,
      approved_at = null,
      approved_by = null,
      approval_rejection_reason = null,
      updated_at = statement_timestamp(),
      lock_version = lock_version + 1
  where organization_id = target_org
    and id = target_version
    and status = 'draft'
    and approval_status <> 'not_submitted';

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

alter function private.invalidate_quote_approval() owner to renoly_rls_owner;
revoke all on function private.invalidate_quote_approval() from public, anon, authenticated;

create or replace function private.calculate_change_order_item()
returns trigger
language plpgsql
set search_path = pg_catalog, public, private
as $$
begin
  new.subtotal_minor := round(new.quantity * new.unit_price_minor)::bigint;
  new.tax_minor := round(new.subtotal_minor * new.tax_rate)::bigint;
  new.total_minor := new.subtotal_minor + new.tax_minor;
  return new;
end;
$$;

revoke all on function private.calculate_change_order_item() from public, anon, authenticated;

create or replace function private.guard_change_order()
returns trigger
language plpgsql
set search_path = pg_catalog, public, private
as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception using errcode = 'P0001', message = 'CHANGE_ORDER_IMMUTABLE';
    end if;
    return old;
  end if;

  if old.status <> 'draft' and row(
    new.title, new.reason, new.kind, new.subtotal_minor, new.tax_minor, new.total_minor, new.currency
  ) is distinct from row(
    old.title, old.reason, old.kind, old.subtotal_minor, old.tax_minor, old.total_minor, old.currency
  ) then
    raise exception using errcode = 'P0001', message = 'CHANGE_ORDER_IMMUTABLE';
  end if;

  if new.status is distinct from old.status and current_user <> 'renoly_rls_owner' then
    raise exception using errcode = 'P0001', message = 'STATUS_TRANSITION_REQUIRES_RPC';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_change_order() from public, anon, authenticated;

create or replace function private.guard_change_order_item_parent()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  parent_status text;
  target_order uuid;
begin
  target_order := case when tg_op = 'DELETE' then old.change_order_id else new.change_order_id end;
  select co.status into parent_status
  from public.change_orders co
  where co.organization_id = case when tg_op = 'DELETE' then old.organization_id else new.organization_id end
    and co.id = target_order;

  if parent_status is distinct from 'draft' then
    raise exception using errcode = 'P0001', message = 'CHANGE_ORDER_IMMUTABLE';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

alter function private.guard_change_order_item_parent() owner to renoly_rls_owner;
revoke all on function private.guard_change_order_item_parent() from public, anon, authenticated;

create or replace function private.append_user_event(
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
  actor_id uuid := (select private.current_actor_user_id());
  occurred timestamptz := coalesce(target_occurred_at, statement_timestamp());
  recorded timestamptz;
  next_chain_sequence bigint;
begin
  if actor_id is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;

  -- Serialize each aggregate's chain even when occurred_at is backdated.
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
    || target_event_type || '|' || actor_id::text || '|' || occurred::text || '|'
    || recorded::text || '|' || next_chain_sequence::text || '|'
    || coalesce(target_payload, '{}'::jsonb)::text,
    'sha256'
  );

  insert into public.events (
    id, organization_id, aggregate_type, aggregate_id, event_type,
    actor_type, actor_user_id, occurred_at, recorded_at, chain_sequence,
    request_id, idempotency_key, payload, prev_hash, event_hash
  ) values (
    event_id, target_org, target_aggregate_type, target_aggregate_id, target_event_type,
    'user', actor_id, occurred, recorded, next_chain_sequence,
    coalesce(target_request_id, gen_random_uuid()), target_idempotency_key,
    coalesce(target_payload, '{}'::jsonb), previous_hash, calculated_hash
  );

  return event_id;
end;
$$;

alter function private.append_user_event(uuid, text, uuid, text, jsonb, uuid, text, timestamptz) owner to renoly_rls_owner;
revoke all on function private.append_user_event(uuid, text, uuid, text, jsonb, uuid, text, timestamptz)
  from public, anon, authenticated;

-- Common integrity and timestamp triggers.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'memberships', 'customers', 'line_channels', 'customer_line_identities',
    'locations', 'assets', 'checklist_templates', 'service_catalogs',
    'service_catalog_items', 'service_requests', 'projects', 'work_orders',
    'assignments', 'work_order_checklists', 'work_order_checklist_items',
    'quotes', 'quote_versions', 'quote_items', 'change_orders',
    'change_order_items', 'payment_milestones', 'photos', 'maintenance_plans',
    'notifications', 'idempotency_keys'
  ] loop
    execute format(
      'create trigger a_protect_tenant_identity before update on public.%I '
      || 'for each row execute function private.protect_tenant_identity()',
      table_name
    );
  end loop;
end
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'organizations', 'memberships', 'customers', 'line_channels',
    'customer_line_identities', 'locations', 'assets', 'checklist_templates',
    'service_catalogs', 'service_catalog_items', 'service_requests', 'projects',
    'work_orders', 'assignments', 'work_order_checklists',
    'work_order_checklist_items', 'quotes', 'quote_versions', 'quote_items',
    'change_orders', 'change_order_items', 'payment_milestones', 'photos',
    'maintenance_plans', 'notifications', 'idempotency_keys'
  ] loop
    execute format(
      'create trigger z_touch_updated_at before update on public.%I '
      || 'for each row execute function public.touch_updated_at()',
      table_name
    );
  end loop;
end
$$;

create trigger z_touch_updated_at
before update on private.line_channel_credentials
for each row execute function public.touch_updated_at();

create trigger b_service_request_status_rpc
before update on public.service_requests
for each row execute function private.require_rpc_status_transition();

create trigger b_project_status_rpc
before update on public.projects
for each row execute function private.require_rpc_status_transition();

create trigger b_work_order_status_rpc
before update on public.work_orders
for each row execute function private.require_rpc_status_transition();

create trigger b_assignment_status_rpc
before update on public.assignments
for each row execute function private.require_rpc_status_transition();

create trigger b_quote_status_rpc
before update on public.quotes
for each row execute function private.require_rpc_status_transition();

create trigger b_payment_status_rpc
before update on public.payment_milestones
for each row execute function private.require_rpc_status_transition();

create trigger b_maintenance_status_rpc
before update on public.maintenance_plans
for each row execute function private.require_rpc_status_transition();

create trigger b_validate_assignment_member
before insert or update of membership_id, organization_id on public.assignments
for each row execute function private.validate_assignment_member();

create trigger b_guard_membership_owner
before update or delete on public.memberships
for each row execute function private.guard_membership_owner();

create trigger a_calculate_quote_item
before insert or update of quantity, unit_price_minor, discount_minor, tax_rate on public.quote_items
for each row execute function private.calculate_quote_item();

create trigger b_guard_quote_item_parent
before insert or update or delete on public.quote_items
for each row execute function private.guard_quote_item_parent();

create trigger c_invalidate_quote_approval
after insert or update or delete on public.quote_items
for each row execute function private.invalidate_quote_approval();

create trigger b_guard_quote_version
before update or delete on public.quote_versions
for each row execute function private.guard_quote_version();

create trigger a_calculate_change_order_item
before insert or update of quantity, unit_price_minor, tax_rate on public.change_order_items
for each row execute function private.calculate_change_order_item();

create trigger b_guard_change_order_item_parent
before insert or update or delete on public.change_order_items
for each row execute function private.guard_change_order_item_parent();

create trigger b_guard_change_order
before update or delete on public.change_orders
for each row execute function private.guard_change_order();

create trigger immutable_events
before update or delete on public.events
for each row execute function private.prevent_append_only_mutation();

create trigger immutable_notification_attempts
before update or delete on public.notification_attempts
for each row execute function private.prevent_append_only_mutation();

-- RLS is enabled and forced for every domain and tenant table. Private credentials
-- additionally have no PostgREST grants.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'organizations', 'memberships', 'customers', 'line_channels',
    'customer_line_identities', 'locations', 'assets', 'checklist_templates',
    'checklist_template_items', 'service_catalogs', 'service_catalog_items',
    'service_requests', 'service_request_time_windows', 'projects', 'work_orders',
    'assignments', 'work_order_checklists', 'work_order_checklist_items',
    'quotes', 'quote_versions', 'quote_items', 'change_orders',
    'change_order_items', 'payment_milestones', 'photos', 'maintenance_plans',
    'notifications', 'notification_attempts', 'line_webhook_events',
    'public_access_tokens', 'idempotency_keys', 'document_sequences', 'events'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('alter table public.%I force row level security', table_name);
  end loop;
end
$$;

alter table private.line_channel_credentials enable row level security;
alter table private.line_channel_credentials force row level security;

revoke all on all tables in schema public from anon;
revoke all on all tables in schema private from public, anon, authenticated;

grant select, insert, update, delete on all tables in schema public to authenticated;

-- Append-only and worker-owned tables never expose direct mutation privileges.
revoke insert, update, delete on public.events from authenticated;
revoke insert, update, delete on public.notification_attempts from authenticated;
revoke insert, update, delete on public.line_webhook_events from authenticated;
revoke insert, update, delete on public.idempotency_keys from authenticated;
revoke insert, update, delete on public.document_sequences from authenticated;

-- Organizations and memberships.
create policy organizations_select_member on public.organizations
for select to authenticated
using ((select public.is_active_member(id)));

create policy organizations_update_admin on public.organizations
for update to authenticated
using ((select public.has_org_role(id, array['owner', 'admin']::text[])))
with check ((select public.has_org_role(id, array['owner', 'admin']::text[])));

create policy memberships_select_scoped on public.memberships
for select to authenticated
using (
  (select public.has_org_role(organization_id, array['owner', 'admin', 'dispatcher']::text[]))
  or (select public.is_current_membership(organization_id, id))
);

create policy memberships_insert_admin on public.memberships
for insert to authenticated
with check ((select public.has_org_role(organization_id, array['owner', 'admin']::text[])));

create policy memberships_update_admin on public.memberships
for update to authenticated
using ((select public.has_org_role(organization_id, array['owner', 'admin']::text[])))
with check ((select public.has_org_role(organization_id, array['owner', 'admin']::text[])));

-- CRM. Managers and limited non-field roles see the tenant; technicians see only
-- records required by an active assignment.
create policy customers_select_scoped on public.customers
for select to authenticated
using (
  (select public.has_org_role(organization_id, array['owner', 'admin', 'dispatcher', 'accountant', 'viewer']::text[]))
  or (select public.is_assigned_to_customer(organization_id, id))
);

create policy customers_insert_manager on public.customers
for insert to authenticated
with check ((select public.has_org_role(organization_id, array['owner', 'admin', 'dispatcher']::text[])));

create policy customers_update_manager on public.customers
for update to authenticated
using ((select public.has_org_role(organization_id, array['owner', 'admin', 'dispatcher']::text[])))
with check ((select public.has_org_role(organization_id, array['owner', 'admin', 'dispatcher']::text[])));

create policy customers_delete_manager_draft on public.customers
for delete to authenticated
using (
  deleted_at is null
  and (select public.has_org_role(organization_id, array['owner', 'admin']::text[]))
);

create policy locations_select_scoped on public.locations
for select to authenticated
using (
  (select public.has_org_role(organization_id, array['owner', 'admin', 'dispatcher', 'accountant', 'viewer']::text[]))
  or (select public.is_assigned_to_location(organization_id, id))
);

create policy locations_insert_manager on public.locations
for insert to authenticated
with check ((select public.has_org_role(organization_id, array['owner', 'admin', 'dispatcher']::text[])));

create policy locations_update_manager on public.locations
for update to authenticated
using ((select public.has_org_role(organization_id, array['owner', 'admin', 'dispatcher']::text[])))
with check ((select public.has_org_role(organization_id, array['owner', 'admin', 'dispatcher']::text[])));

create policy locations_delete_admin on public.locations
for delete to authenticated
using ((select public.has_org_role(organization_id, array['owner', 'admin']::text[])));

create policy assets_select_scoped on public.assets
for select to authenticated
using (
  (select public.has_org_role(organization_id, array['owner', 'admin', 'dispatcher', 'accountant', 'viewer']::text[]))
  or (select public.is_assigned_to_asset(organization_id, id))
);

create policy assets_insert_manager on public.assets
for insert to authenticated
with check ((select public.has_org_role(organization_id, array['owner', 'admin', 'dispatcher']::text[])));

create policy assets_update_manager on public.assets
for update to authenticated
using ((select public.has_org_role(organization_id, array['owner', 'admin', 'dispatcher']::text[])))
with check ((select public.has_org_role(organization_id, array['owner', 'admin', 'dispatcher']::text[])));

create policy assets_delete_admin on public.assets
for delete to authenticated
using ((select public.has_org_role(organization_id, array['owner', 'admin']::text[])));

create policy line_channels_select_owner on public.line_channels
for select to authenticated
using ((select public.has_org_role(organization_id, array['owner', 'admin']::text[])));

create policy line_channels_insert_owner on public.line_channels
for insert to authenticated
with check ((select public.has_org_role(organization_id, array['owner', 'admin']::text[])));

create policy line_channels_update_owner on public.line_channels
for update to authenticated
using ((select public.has_org_role(organization_id, array['owner', 'admin']::text[])))
with check ((select public.has_org_role(organization_id, array['owner', 'admin']::text[])));

create policy customer_line_identities_select_manager on public.customer_line_identities
for select to authenticated
using ((select public.has_org_role(organization_id, array['owner', 'admin', 'dispatcher']::text[])));

create policy customer_line_identities_insert_manager on public.customer_line_identities
for insert to authenticated
with check ((select public.has_org_role(organization_id, array['owner', 'admin', 'dispatcher']::text[])));

create policy customer_line_identities_update_manager on public.customer_line_identities
for update to authenticated
using ((select public.has_org_role(organization_id, array['owner', 'admin', 'dispatcher']::text[])))
with check ((select public.has_org_role(organization_id, array['owner', 'admin', 'dispatcher']::text[])));

-- Templates and service catalog. Cost-bearing catalog rows are not exposed to
-- technicians/viewers until a redacted view exists.
create policy checklist_templates_select_manager on public.checklist_templates
for select to authenticated
using ((select public.has_org_role(organization_id, array['owner', 'admin', 'dispatcher']::text[])));

create policy checklist_templates_write_manager on public.checklist_templates
for all to authenticated
using ((select public.has_org_role(organization_id, array['owner', 'admin', 'dispatcher']::text[])))
with check ((select public.has_org_role(organization_id, array['owner', 'admin', 'dispatcher']::text[])));

create policy checklist_template_items_select_manager on public.checklist_template_items
for select to authenticated
using ((select public.has_org_role(organization_id, array['owner', 'admin', 'dispatcher']::text[])));

create policy checklist_template_items_write_manager on public.checklist_template_items
for all to authenticated
using ((select public.has_org_role(organization_id, array['owner', 'admin', 'dispatcher']::text[])))
with check ((select public.has_org_role(organization_id, array['owner', 'admin', 'dispatcher']::text[])));

create policy service_catalogs_select_financial on public.service_catalogs
for select to authenticated
using ((select public.has_org_role(organization_id, array['owner', 'admin', 'dispatcher', 'accountant']::text[])));

create policy service_catalogs_write_manager on public.service_catalogs
for all to authenticated
using ((select public.has_org_role(organization_id, array['owner', 'admin', 'dispatcher']::text[])))
with check ((select public.has_org_role(organization_id, array['owner', 'admin', 'dispatcher']::text[])));

create policy service_catalog_items_select_financial on public.service_catalog_items
for select to authenticated
using ((select public.has_org_role(organization_id, array['owner', 'admin', 'dispatcher', 'accountant']::text[])));

create policy service_catalog_items_write_manager on public.service_catalog_items
for all to authenticated
using ((select public.has_org_role(organization_id, array['owner', 'admin', 'dispatcher']::text[])))
with check ((select public.has_org_role(organization_id, array['owner', 'admin', 'dispatcher']::text[])));

-- Requests and projects.
create policy service_requests_select_scoped on public.service_requests
for select to authenticated
using (
  (select public.has_org_role(organization_id, array['owner', 'admin', 'dispatcher', 'accountant', 'viewer']::text[]))
  or (select public.is_assigned_to_service_request(organization_id, id))
);

create policy service_requests_insert_manager on public.service_requests
for insert to authenticated
with check ((select public.has_org_role(organization_id, array['owner', 'admin', 'dispatcher']::text[])));

create policy service_requests_update_manager on public.service_requests
for update to authenticated
using ((select public.has_org_role(organization_id, array['owner', 'admin', 'dispatcher']::text[])))
with check ((select public.has_org_role(organization_id, array['owner', 'admin', 'dispatcher']::text[])));

create policy service_requests_delete_draft on public.service_requests
for delete to authenticated
using (
  status = 'new'
  and (select public.has_org_role(organization_id, array['owner', 'admin']::text[]))
);

create policy service_request_windows_select_scoped on public.service_request_time_windows
for select to authenticated
using (
  (select public.has_org_role(organization_id, array['owner', 'admin', 'dispatcher', 'accountant', 'viewer']::text[]))
  or (select public.is_assigned_to_service_request(organization_id, service_request_id))
);

create policy service_request_windows_write_manager on public.service_request_time_windows
for all to authenticated
using ((select public.has_org_role(organization_id, array['owner', 'admin', 'dispatcher']::text[])))
with check ((select public.has_org_role(organization_id, array['owner', 'admin', 'dispatcher']::text[])));

create policy projects_select_scoped on public.projects
for select to authenticated
using (
  (select public.has_org_role(organization_id, array['owner', 'admin', 'dispatcher', 'accountant', 'viewer']::text[]))
  or (select public.is_assigned_to_project(organization_id, id))
);

create policy projects_insert_manager on public.projects
for insert to authenticated
with check ((select public.has_org_role(organization_id, array['owner', 'admin', 'dispatcher']::text[])));

create policy projects_update_manager on public.projects
for update to authenticated
using ((select public.has_org_role(organization_id, array['owner', 'admin', 'dispatcher']::text[])))
with check ((select public.has_org_role(organization_id, array['owner', 'admin', 'dispatcher']::text[])));

-- Work execution. Direct work-order and assignment state updates are blocked by
-- triggers; technicians use the transaction RPCs below.
create policy work_orders_select_scoped on public.work_orders
for select to authenticated
using (
  (select public.has_org_role(organization_id, array['owner', 'admin', 'dispatcher', 'accountant', 'viewer']::text[]))
  or (select public.is_assigned_to_work_order(organization_id, id))
);

create policy work_orders_insert_manager on public.work_orders
for insert to authenticated
with check ((select public.has_org_role(organization_id, array['owner', 'admin', 'dispatcher']::text[])));

create policy work_orders_update_manager on public.work_orders
for update to authenticated
using ((select public.has_org_role(organization_id, array['owner', 'admin', 'dispatcher']::text[])))
with check ((select public.has_org_role(organization_id, array['owner', 'admin', 'dispatcher']::text[])));

create policy assignments_select_scoped on public.assignments
for select to authenticated
using (
  (select public.has_org_role(organization_id, array['owner', 'admin', 'dispatcher', 'viewer']::text[]))
  or (select public.is_current_membership(organization_id, membership_id))
);

create policy assignments_insert_manager on public.assignments
for insert to authenticated
with check ((select public.has_org_role(organization_id, array['owner', 'admin', 'dispatcher']::text[])));

create policy assignments_update_manager on public.assignments
for update to authenticated
using ((select public.has_org_role(organization_id, array['owner', 'admin', 'dispatcher']::text[])))
with check ((select public.has_org_role(organization_id, array['owner', 'admin', 'dispatcher']::text[])));

create policy work_order_checklists_select_scoped on public.work_order_checklists
for select to authenticated
using (
  (select public.has_org_role(organization_id, array['owner', 'admin', 'dispatcher', 'accountant', 'viewer']::text[]))
  or (select public.is_assigned_to_work_order(organization_id, work_order_id))
);

create policy work_order_checklists_write_scoped on public.work_order_checklists
for all to authenticated
using (
  (select public.has_org_role(organization_id, array['owner', 'admin', 'dispatcher']::text[]))
  or (select public.is_assigned_to_work_order(organization_id, work_order_id))
)
with check (
  (select public.has_org_role(organization_id, array['owner', 'admin', 'dispatcher']::text[]))
  or (select public.is_assigned_to_work_order(organization_id, work_order_id))
);

create policy work_order_checklist_items_select_scoped on public.work_order_checklist_items
for select to authenticated
using (
  (select public.has_org_role(organization_id, array['owner', 'admin', 'dispatcher', 'accountant', 'viewer']::text[]))
  or (select public.is_assigned_to_work_order(organization_id, work_order_id))
);

create policy work_order_checklist_items_write_scoped on public.work_order_checklist_items
for all to authenticated
using (
  (select public.has_org_role(organization_id, array['owner', 'admin', 'dispatcher']::text[]))
  or (select public.is_assigned_to_work_order(organization_id, work_order_id))
)
with check (
  (select public.has_org_role(organization_id, array['owner', 'admin', 'dispatcher']::text[]))
  or (select public.is_assigned_to_work_order(organization_id, work_order_id))
);

create policy photos_select_scoped on public.photos
for select to authenticated
using (
  (select public.has_org_role(organization_id, array['owner', 'admin', 'dispatcher', 'accountant', 'viewer']::text[]))
  or (
    work_order_id is not null
    and (select public.is_assigned_to_work_order(organization_id, work_order_id))
  )
);

create policy photos_insert_scoped on public.photos
for insert to authenticated
with check (
  (select public.has_org_role(organization_id, array['owner', 'admin', 'dispatcher']::text[]))
  or (
    work_order_id is not null
    and (select public.is_assigned_to_work_order(organization_id, work_order_id))
    and (select public.is_current_membership(organization_id, uploaded_by_membership_id))
  )
);

create policy photos_update_scoped on public.photos
for update to authenticated
using (
  (select public.has_org_role(organization_id, array['owner', 'admin', 'dispatcher']::text[]))
  or (
    work_order_id is not null
    and (select public.is_assigned_to_work_order(organization_id, work_order_id))
    and (select public.is_current_membership(organization_id, uploaded_by_membership_id))
  )
)
with check (
  (select public.has_org_role(organization_id, array['owner', 'admin', 'dispatcher']::text[]))
  or (
    work_order_id is not null
    and (select public.is_assigned_to_work_order(organization_id, work_order_id))
    and (select public.is_current_membership(organization_id, uploaded_by_membership_id))
  )
);

-- Quotes and cost-bearing line items remain inaccessible to technician/viewer
-- roles at the table layer. Redacted API DTOs can be introduced later.
create policy quotes_select_financial on public.quotes
for select to authenticated
using ((select public.has_org_role(organization_id, array['owner', 'admin', 'dispatcher', 'accountant']::text[])));

create policy quotes_insert_manager on public.quotes
for insert to authenticated
with check ((select public.has_org_role(organization_id, array['owner', 'admin', 'dispatcher']::text[])));

create policy quotes_update_manager on public.quotes
for update to authenticated
using ((select public.has_org_role(organization_id, array['owner', 'admin', 'dispatcher']::text[])))
with check ((select public.has_org_role(organization_id, array['owner', 'admin', 'dispatcher']::text[])));

create policy quote_versions_select_financial on public.quote_versions
for select to authenticated
using ((select public.has_org_role(organization_id, array['owner', 'admin', 'dispatcher', 'accountant']::text[])));

create policy quote_versions_insert_manager on public.quote_versions
for insert to authenticated
with check ((select public.has_org_role(organization_id, array['owner', 'admin', 'dispatcher']::text[])));

create policy quote_versions_update_manager on public.quote_versions
for update to authenticated
using ((select public.has_org_role(organization_id, array['owner', 'admin', 'dispatcher']::text[])))
with check ((select public.has_org_role(organization_id, array['owner', 'admin', 'dispatcher']::text[])));

create policy quote_versions_delete_draft on public.quote_versions
for delete to authenticated
using (
  status = 'draft'
  and (select public.has_org_role(organization_id, array['owner', 'admin']::text[]))
);

create policy quote_items_select_financial on public.quote_items
for select to authenticated
using ((select public.has_org_role(organization_id, array['owner', 'admin', 'dispatcher', 'accountant']::text[])));

create policy quote_items_write_manager on public.quote_items
for all to authenticated
using ((select public.has_org_role(organization_id, array['owner', 'admin', 'dispatcher']::text[])))
with check ((select public.has_org_role(organization_id, array['owner', 'admin', 'dispatcher']::text[])));

create policy change_orders_select_financial on public.change_orders
for select to authenticated
using ((select public.has_org_role(organization_id, array['owner', 'admin', 'dispatcher', 'accountant']::text[])));

create policy change_orders_insert_manager on public.change_orders
for insert to authenticated
with check ((select public.has_org_role(organization_id, array['owner', 'admin', 'dispatcher']::text[])));

create policy change_orders_update_manager on public.change_orders
for update to authenticated
using ((select public.has_org_role(organization_id, array['owner', 'admin', 'dispatcher']::text[])))
with check ((select public.has_org_role(organization_id, array['owner', 'admin', 'dispatcher']::text[])));

create policy change_orders_delete_draft on public.change_orders
for delete to authenticated
using (
  status = 'draft'
  and (select public.has_org_role(organization_id, array['owner', 'admin']::text[]))
);

create policy change_order_items_select_financial on public.change_order_items
for select to authenticated
using ((select public.has_org_role(organization_id, array['owner', 'admin', 'dispatcher', 'accountant']::text[])));

create policy change_order_items_write_manager on public.change_order_items
for all to authenticated
using ((select public.has_org_role(organization_id, array['owner', 'admin', 'dispatcher']::text[])))
with check ((select public.has_org_role(organization_id, array['owner', 'admin', 'dispatcher']::text[])));

create policy payment_milestones_select_financial on public.payment_milestones
for select to authenticated
using ((select public.has_org_role(organization_id, array['owner', 'admin', 'dispatcher', 'accountant', 'viewer']::text[])));

create policy payment_milestones_insert_financial on public.payment_milestones
for insert to authenticated
with check ((select public.has_org_role(organization_id, array['owner', 'admin', 'accountant']::text[])));

create policy payment_milestones_update_financial on public.payment_milestones
for update to authenticated
using ((select public.has_org_role(organization_id, array['owner', 'admin', 'accountant']::text[])))
with check ((select public.has_org_role(organization_id, array['owner', 'admin', 'accountant']::text[])));

create policy maintenance_plans_select_member on public.maintenance_plans
for select to authenticated
using (
  (select public.has_org_role(organization_id, array['owner', 'admin', 'dispatcher', 'accountant', 'viewer']::text[]))
  or (
    last_completed_work_order_id is not null
    and (select public.is_assigned_to_work_order(organization_id, last_completed_work_order_id))
  )
);

create policy maintenance_plans_insert_manager on public.maintenance_plans
for insert to authenticated
with check ((select public.has_org_role(organization_id, array['owner', 'admin', 'dispatcher']::text[])));

create policy maintenance_plans_update_manager on public.maintenance_plans
for update to authenticated
using ((select public.has_org_role(organization_id, array['owner', 'admin', 'dispatcher']::text[])))
with check ((select public.has_org_role(organization_id, array['owner', 'admin', 'dispatcher']::text[])));

-- Outbox rows can be managed by operations roles; worker inbox/support tables
-- intentionally have no authenticated policy.
create policy notifications_select_scoped on public.notifications
for select to authenticated
using (
  (select public.has_org_role(organization_id, array['owner', 'admin', 'dispatcher']::text[]))
  or (
    membership_id is not null
    and (select public.is_current_membership(organization_id, membership_id))
  )
);

create policy notifications_insert_manager on public.notifications
for insert to authenticated
with check ((select public.has_org_role(organization_id, array['owner', 'admin', 'dispatcher']::text[])));

create policy notifications_update_manager on public.notifications
for update to authenticated
using ((select public.has_org_role(organization_id, array['owner', 'admin', 'dispatcher']::text[])))
with check ((select public.has_org_role(organization_id, array['owner', 'admin', 'dispatcher']::text[])));

create policy notification_attempts_select_manager on public.notification_attempts
for select to authenticated
using ((select public.has_org_role(organization_id, array['owner', 'admin', 'dispatcher']::text[])));

create policy public_access_tokens_select_manager on public.public_access_tokens
for select to authenticated
using ((select public.has_org_role(organization_id, array['owner', 'admin', 'dispatcher']::text[])));

create policy public_access_tokens_insert_manager on public.public_access_tokens
for insert to authenticated
with check ((select public.has_org_role(organization_id, array['owner', 'admin', 'dispatcher']::text[])));

create policy public_access_tokens_update_manager on public.public_access_tokens
for update to authenticated
using ((select public.has_org_role(organization_id, array['owner', 'admin', 'dispatcher']::text[])))
with check ((select public.has_org_role(organization_id, array['owner', 'admin', 'dispatcher']::text[])));

create policy events_select_auditor on public.events
for select to authenticated
using ((select public.has_org_role(organization_id, array['owner', 'admin', 'dispatcher', 'accountant', 'viewer']::text[])));

-- Transaction RPC: deterministic document number allocation.
create or replace function public.next_document_number(
  target_org uuid,
  target_document_type text,
  target_period_key text
)
returns bigint
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  next_value bigint;
begin
  if not public.has_org_role(target_org, array['owner', 'admin', 'dispatcher']::text[]) then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;

  if target_document_type not in ('customer', 'request', 'project', 'work_order', 'quote', 'change_order')
     or char_length(target_period_key) not between 1 and 20 then
    raise exception using errcode = '22023', message = 'INVALID_DOCUMENT_SEQUENCE';
  end if;

  insert into public.document_sequences (organization_id, document_type, period_key, current_value)
  values (target_org, target_document_type, target_period_key, 1)
  on conflict (organization_id, document_type, period_key)
  do update set current_value = public.document_sequences.current_value + 1,
                updated_at = statement_timestamp()
  returning current_value into next_value;

  return next_value;
end;
$$;

alter function public.next_document_number(uuid, text, text) owner to renoly_rls_owner;
revoke all on function public.next_document_number(uuid, text, text) from public;
grant execute on function public.next_document_number(uuid, text, text) to authenticated;

-- Service request transition RPC. Conversion links must already be written in the
-- same application transaction or a future convert RPC before `converted`.
create or replace function public.transition_service_request(
  target_org uuid,
  target_request uuid,
  target_status text,
  expected_lock_version integer,
  reason text default null,
  target_request_id uuid default null,
  target_idempotency_key text default null
)
returns public.service_requests
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  current_record public.service_requests%rowtype;
  result_record public.service_requests%rowtype;
begin
  if not public.has_org_role(target_org, array['owner', 'admin', 'dispatcher']::text[]) then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;

  select * into current_record
  from public.service_requests
  where organization_id = target_org and id = target_request
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'SERVICE_REQUEST_NOT_FOUND';
  end if;
  if current_record.lock_version is distinct from expected_lock_version then
    raise exception using errcode = '40001', message = 'STALE_VERSION';
  end if;

  if not (
    (current_record.status = 'new' and target_status in ('triaged', 'declined', 'cancelled'))
    or (current_record.status = 'triaged' and target_status in ('quoting', 'converted', 'declined', 'cancelled'))
    or (current_record.status = 'quoting' and target_status in ('quoted', 'converted', 'declined', 'cancelled'))
    or (current_record.status = 'quoted' and target_status in ('quoting', 'converted', 'declined', 'cancelled'))
  ) then
    raise exception using errcode = '23514', message = 'INVALID_SERVICE_REQUEST_TRANSITION';
  end if;

  if target_status = 'triaged' and current_record.customer_id is null then
    raise exception using errcode = '23514', message = 'TRIAGE_REQUIRES_CUSTOMER';
  end if;
  if target_status = 'quoted' and not exists (
    select 1 from public.quotes q
    where q.organization_id = target_org
      and q.service_request_id = target_request
      and q.status in ('sent', 'viewed', 'accepted')
  ) then
    raise exception using errcode = '23514', message = 'QUOTED_REQUIRES_SENT_QUOTE';
  end if;
  if target_status = 'converted'
     and current_record.converted_project_id is null
     and current_record.converted_work_order_id is null then
    raise exception using errcode = '23514', message = 'CONVERSION_TARGET_REQUIRED';
  end if;
  if target_status in ('declined', 'cancelled') and nullif(btrim(reason), '') is null then
    raise exception using errcode = '23514', message = 'CLOSE_REASON_REQUIRED';
  end if;

  update public.service_requests
  set status = target_status,
      triaged_at = case when target_status = 'triaged' then statement_timestamp() else triaged_at end,
      quoted_at = case when target_status = 'quoted' then statement_timestamp() else quoted_at end,
      converted_at = case when target_status = 'converted' then statement_timestamp() else converted_at end,
      closed_at = case when target_status in ('declined', 'cancelled') then statement_timestamp() else closed_at end,
      decline_reason = case when target_status = 'declined' then reason else decline_reason end,
      cancellation_reason = case when target_status = 'cancelled' then reason else cancellation_reason end,
      updated_by = (select private.current_actor_user_id()),
      lock_version = lock_version + 1
  where organization_id = target_org and id = target_request
  returning * into result_record;

  perform private.append_user_event(
    target_org, 'service_request', target_request,
    'service_request.' || target_status,
    jsonb_build_object('from', current_record.status, 'to', target_status, 'reason', reason),
    target_request_id, target_idempotency_key
  );
  return result_record;
end;
$$;

alter function public.transition_service_request(uuid, uuid, text, integer, text, uuid, text)
  owner to renoly_rls_owner;
revoke all on function public.transition_service_request(uuid, uuid, text, integer, text, uuid, text)
  from public;
grant execute on function public.transition_service_request(uuid, uuid, text, integer, text, uuid, text)
  to authenticated;

create or replace function public.transition_assignment(
  target_org uuid,
  target_assignment uuid,
  target_status text,
  expected_lock_version integer,
  reason text default null,
  target_request_id uuid default null,
  target_idempotency_key text default null
)
returns public.assignments
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  current_record public.assignments%rowtype;
  result_record public.assignments%rowtype;
  is_manager boolean;
  is_self boolean;
begin
  select * into current_record
  from public.assignments
  where organization_id = target_org and id = target_assignment
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'ASSIGNMENT_NOT_FOUND';
  end if;

  is_manager := public.has_org_role(target_org, array['owner', 'admin', 'dispatcher']::text[]);
  is_self := public.is_current_membership(target_org, current_record.membership_id);
  if not is_manager and not is_self then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;
  if current_record.lock_version is distinct from expected_lock_version then
    raise exception using errcode = '40001', message = 'STALE_VERSION';
  end if;

  if not (
    (current_record.status = 'assigned' and target_status in ('accepted', 'declined', 'cancelled'))
    or (current_record.status = 'accepted' and target_status in ('checked_in', 'cancelled'))
    or (current_record.status = 'checked_in' and target_status in ('completed', 'cancelled'))
  ) then
    raise exception using errcode = '23514', message = 'INVALID_ASSIGNMENT_TRANSITION';
  end if;
  if target_status = 'cancelled' and not is_manager then
    raise exception using errcode = '42501', message = 'ASSIGNMENT_CANCEL_REQUIRES_MANAGER';
  end if;
  if target_status = 'declined' and nullif(btrim(reason), '') is null then
    raise exception using errcode = '23514', message = 'DECLINE_REASON_REQUIRED';
  end if;

  update public.assignments
  set status = target_status,
      accepted_at = case when target_status = 'accepted' then statement_timestamp() else accepted_at end,
      declined_at = case when target_status = 'declined' then statement_timestamp() else declined_at end,
      checked_in_at = case when target_status = 'checked_in' then statement_timestamp() else checked_in_at end,
      checked_out_at = case when target_status = 'completed' then statement_timestamp() else checked_out_at end,
      completed_at = case when target_status = 'completed' then statement_timestamp() else completed_at end,
      cancelled_at = case when target_status = 'cancelled' then statement_timestamp() else cancelled_at end,
      decline_reason = case when target_status = 'declined' then reason else decline_reason end,
      updated_by = (select private.current_actor_user_id()),
      lock_version = lock_version + 1
  where organization_id = target_org and id = target_assignment
  returning * into result_record;

  perform private.append_user_event(
    target_org, 'work_order', current_record.work_order_id,
    'assignment.' || target_status,
    jsonb_build_object(
      'assignmentId', target_assignment,
      'membershipId', current_record.membership_id,
      'from', current_record.status,
      'to', target_status,
      'reason', reason
    ),
    target_request_id, target_idempotency_key
  );
  return result_record;
end;
$$;

alter function public.transition_assignment(uuid, uuid, text, integer, text, uuid, text)
  owner to renoly_rls_owner;
revoke all on function public.transition_assignment(uuid, uuid, text, integer, text, uuid, text)
  from public;
grant execute on function public.transition_assignment(uuid, uuid, text, integer, text, uuid, text)
  to authenticated;

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
        and ci.response is null
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

alter function public.transition_work_order(uuid, uuid, text, integer, timestamptz, text, text, text, uuid, text)
  owner to renoly_rls_owner;
revoke all on function public.transition_work_order(uuid, uuid, text, integer, timestamptz, text, text, text, uuid, text)
  from public;
grant execute on function public.transition_work_order(uuid, uuid, text, integer, timestamptz, text, text, text, uuid, text)
  to authenticated;

create or replace function public.submit_quote_version_for_approval(
  target_org uuid,
  target_quote_version uuid,
  expected_lock_version integer,
  target_request_id uuid default null,
  target_idempotency_key text default null
)
returns public.quote_versions
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  current_record public.quote_versions%rowtype;
  result_record public.quote_versions%rowtype;
  item_count integer;
  subtotal_sum bigint;
  discount_sum bigint;
  tax_sum bigint;
  total_sum bigint;
begin
  if not public.has_org_role(target_org, array['owner', 'admin', 'dispatcher']::text[]) then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;

  select * into current_record
  from public.quote_versions
  where organization_id = target_org and id = target_quote_version
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'QUOTE_VERSION_NOT_FOUND';
  end if;
  if current_record.status <> 'draft' then
    raise exception using errcode = '23514', message = 'QUOTE_VERSION_IMMUTABLE';
  end if;
  if current_record.approval_status not in ('not_submitted', 'changes_requested') then
    raise exception using errcode = '23514', message = 'QUOTE_APPROVAL_STATE_CONFLICT';
  end if;
  if current_record.lock_version is distinct from expected_lock_version then
    raise exception using errcode = '40001', message = 'STALE_VERSION';
  end if;

  select count(*)::integer,
         coalesce(sum(qi.subtotal_minor), 0)::bigint,
         coalesce(sum(qi.discount_minor), 0)::bigint,
         coalesce(sum(qi.tax_minor), 0)::bigint,
         coalesce(sum(qi.total_minor), 0)::bigint
  into item_count, subtotal_sum, discount_sum, tax_sum, total_sum
  from public.quote_items qi
  where qi.organization_id = target_org and qi.quote_version_id = target_quote_version;

  if item_count = 0 then
    raise exception using errcode = '23514', message = 'QUOTE_ITEMS_REQUIRED';
  end if;

  update public.quote_versions
  set subtotal_minor = subtotal_sum,
      discount_minor = discount_sum,
      tax_minor = tax_sum,
      total_minor = total_sum,
      approval_status = 'pending',
      submitted_for_approval_at = statement_timestamp(),
      submitted_for_approval_by = (select private.current_actor_user_id()),
      approved_at = null,
      approved_by = null,
      approval_rejection_reason = null,
      updated_by = (select private.current_actor_user_id()),
      lock_version = lock_version + 1
  where organization_id = target_org and id = target_quote_version
  returning * into result_record;

  perform private.append_user_event(
    target_org, 'quote', current_record.quote_id, 'quote.approval_submitted',
    jsonb_build_object('quoteVersionId', target_quote_version, 'versionNo', current_record.version_no),
    target_request_id, target_idempotency_key
  );
  return result_record;
end;
$$;

alter function public.submit_quote_version_for_approval(uuid, uuid, integer, uuid, text)
  owner to renoly_rls_owner;
revoke all on function public.submit_quote_version_for_approval(uuid, uuid, integer, uuid, text)
  from public;
grant execute on function public.submit_quote_version_for_approval(uuid, uuid, integer, uuid, text)
  to authenticated;

create or replace function public.review_quote_version(
  target_org uuid,
  target_quote_version uuid,
  expected_lock_version integer,
  approve boolean,
  reason text default null,
  target_request_id uuid default null,
  target_idempotency_key text default null
)
returns public.quote_versions
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  current_record public.quote_versions%rowtype;
  result_record public.quote_versions%rowtype;
begin
  if not public.has_org_role(target_org, array['owner', 'admin']::text[]) then
    raise exception using errcode = '42501', message = 'QUOTE_APPROVER_ROLE_REQUIRED';
  end if;

  select * into current_record
  from public.quote_versions
  where organization_id = target_org and id = target_quote_version
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'QUOTE_VERSION_NOT_FOUND';
  end if;
  if current_record.status <> 'draft' or current_record.approval_status <> 'pending' then
    raise exception using errcode = '23514', message = 'QUOTE_APPROVAL_STATE_CONFLICT';
  end if;
  if current_record.lock_version is distinct from expected_lock_version then
    raise exception using errcode = '40001', message = 'STALE_VERSION';
  end if;
  if not approve and nullif(btrim(reason), '') is null then
    raise exception using errcode = '23514', message = 'CHANGES_REQUESTED_REASON_REQUIRED';
  end if;

  update public.quote_versions
  set approval_status = case when approve then 'approved' else 'changes_requested' end,
      approved_at = case when approve then statement_timestamp() else null end,
      approved_by = case when approve then (select private.current_actor_user_id()) else null end,
      approval_rejection_reason = case when approve then null else reason end,
      updated_by = (select private.current_actor_user_id()),
      lock_version = lock_version + 1
  where organization_id = target_org and id = target_quote_version
  returning * into result_record;

  perform private.append_user_event(
    target_org, 'quote', current_record.quote_id,
    case when approve then 'quote.approved' else 'quote.changes_requested' end,
    jsonb_build_object('quoteVersionId', target_quote_version, 'versionNo', current_record.version_no, 'reason', reason),
    target_request_id, target_idempotency_key
  );
  return result_record;
end;
$$;

alter function public.review_quote_version(uuid, uuid, integer, boolean, text, uuid, text)
  owner to renoly_rls_owner;
revoke all on function public.review_quote_version(uuid, uuid, integer, boolean, text, uuid, text)
  from public;
grant execute on function public.review_quote_version(uuid, uuid, integer, boolean, text, uuid, text)
  to authenticated;

create or replace function public.send_quote_version(
  target_org uuid,
  target_quote_version uuid,
  expected_lock_version integer,
  target_request_id uuid default null,
  target_idempotency_key text default null
)
returns public.quote_versions
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  current_version public.quote_versions%rowtype;
  current_quote public.quotes%rowtype;
  result_record public.quote_versions%rowtype;
begin
  if not public.has_org_role(target_org, array['owner', 'admin']::text[]) then
    raise exception using errcode = '42501', message = 'QUOTE_SEND_ROLE_REQUIRED';
  end if;

  select * into current_version
  from public.quote_versions
  where organization_id = target_org and id = target_quote_version
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'QUOTE_VERSION_NOT_FOUND';
  end if;

  select * into current_quote
  from public.quotes
  where organization_id = target_org and id = current_version.quote_id
  for update;

  if current_version.status <> 'draft' or current_version.approval_status <> 'approved' then
    raise exception using errcode = '23514', message = 'QUOTE_VERSION_NOT_APPROVED';
  end if;
  if current_version.lock_version is distinct from expected_lock_version then
    raise exception using errcode = '40001', message = 'STALE_VERSION';
  end if;
  if current_version.valid_until is not null and current_version.valid_until < current_date then
    raise exception using errcode = '23514', message = 'QUOTE_ALREADY_EXPIRED';
  end if;

  if current_quote.active_version_id is not null
     and current_quote.active_version_id <> target_quote_version then
    update public.quote_versions
    set status = 'superseded',
        updated_by = (select private.current_actor_user_id()),
        lock_version = lock_version + 1
    where organization_id = target_org
      and id = current_quote.active_version_id
      and status = 'sent';
  end if;

  update public.quote_versions
  set status = 'sent',
      sent_at = statement_timestamp(),
      updated_by = (select private.current_actor_user_id()),
      lock_version = lock_version + 1
  where organization_id = target_org and id = target_quote_version
  returning * into result_record;

  update public.quotes
  set status = 'sent',
      latest_version_id = target_quote_version,
      active_version_id = target_quote_version,
      sent_at = statement_timestamp(),
      expires_at = case
        when current_version.valid_until is null then null
        else (current_version.valid_until::timestamp + interval '1 day') at time zone 'Asia/Taipei'
      end,
      updated_by = (select private.current_actor_user_id()),
      lock_version = lock_version + 1
  where organization_id = target_org and id = current_version.quote_id;

  perform private.append_user_event(
    target_org, 'quote', current_version.quote_id, 'quote.sent',
    jsonb_build_object('quoteVersionId', target_quote_version, 'versionNo', current_version.version_no),
    target_request_id, target_idempotency_key
  );
  return result_record;
end;
$$;

alter function public.send_quote_version(uuid, uuid, integer, uuid, text)
  owner to renoly_rls_owner;
revoke all on function public.send_quote_version(uuid, uuid, integer, uuid, text)
  from public;
grant execute on function public.send_quote_version(uuid, uuid, integer, uuid, text)
  to authenticated;

create or replace function public.send_change_order(
  target_org uuid,
  target_change_order uuid,
  expected_lock_version integer,
  target_request_id uuid default null,
  target_idempotency_key text default null
)
returns public.change_orders
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  current_record public.change_orders%rowtype;
  result_record public.change_orders%rowtype;
  item_count integer;
  subtotal_sum bigint;
  tax_sum bigint;
  total_sum bigint;
begin
  if not public.has_org_role(target_org, array['owner', 'admin']::text[]) then
    raise exception using errcode = '42501', message = 'CHANGE_ORDER_SEND_REQUIRES_OWNER';
  end if;

  select * into current_record
  from public.change_orders
  where organization_id = target_org and id = target_change_order
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'CHANGE_ORDER_NOT_FOUND';
  end if;
  if current_record.status <> 'draft' then
    raise exception using errcode = '23514', message = 'CHANGE_ORDER_IMMUTABLE';
  end if;
  if current_record.lock_version is distinct from expected_lock_version then
    raise exception using errcode = '40001', message = 'STALE_VERSION';
  end if;

  select count(*)::integer,
         coalesce(sum(coi.subtotal_minor), 0)::bigint,
         coalesce(sum(coi.tax_minor), 0)::bigint,
         coalesce(sum(coi.total_minor), 0)::bigint
  into item_count, subtotal_sum, tax_sum, total_sum
  from public.change_order_items coi
  where coi.organization_id = target_org and coi.change_order_id = target_change_order;

  if item_count = 0 then
    raise exception using errcode = '23514', message = 'CHANGE_ORDER_ITEMS_REQUIRED';
  end if;

  update public.change_orders
  set status = 'sent',
      subtotal_minor = subtotal_sum,
      tax_minor = tax_sum,
      total_minor = total_sum,
      sent_at = statement_timestamp(),
      updated_by = (select private.current_actor_user_id()),
      lock_version = lock_version + 1
  where organization_id = target_org and id = target_change_order
  returning * into result_record;

  perform private.append_user_event(
    target_org, 'change_order', target_change_order, 'change_order.sent',
    jsonb_build_object('totalMinor', total_sum, 'kind', current_record.kind),
    target_request_id, target_idempotency_key
  );
  return result_record;
end;
$$;

alter function public.send_change_order(uuid, uuid, integer, uuid, text)
  owner to renoly_rls_owner;
revoke all on function public.send_change_order(uuid, uuid, integer, uuid, text)
  from public;
grant execute on function public.send_change_order(uuid, uuid, integer, uuid, text)
  to authenticated;

-- No direct browser policies are created for storage.objects. Upload and read
-- access is issued by the server as short-lived signed URLs after resource checks.
