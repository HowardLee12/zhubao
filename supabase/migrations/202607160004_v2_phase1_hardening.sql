-- Phase 1 hardening after adversarial authorization review.
-- The surface is intentionally narrow: unavailable operations fail closed until a
-- resource-specific RPC/API DTO exists.

-- Direct aggregate writes could change pointers, approval fields or immutable
-- metadata. Creation/edit RPCs will be added alongside their API stories.
revoke insert, update, delete on public.quotes from authenticated;
revoke insert, update, delete on public.quote_versions from authenticated;
revoke insert, update, delete on public.change_orders from authenticated;
revoke update, delete on public.work_orders from authenticated;
revoke insert, update, delete on public.work_order_checklists from authenticated;
revoke insert, update, delete on public.work_order_checklist_items from authenticated;
revoke insert, update, delete on public.photos from authenticated;
revoke insert, update, delete on public.public_access_tokens from authenticated;

-- Owner/admin membership management must agree with the documented boundary:
-- admins can manage non-owner rows, while any owner-row mutation requires owner.
drop policy if exists memberships_insert_admin on public.memberships;
drop policy if exists memberships_update_admin on public.memberships;

create policy memberships_insert_admin on public.memberships
for insert to authenticated
with check (
  (select public.has_org_role(organization_id, array['owner']::text[]))
  or (
    role <> 'owner'
    and (select public.has_org_role(organization_id, array['admin']::text[]))
  )
);

create policy memberships_update_admin on public.memberships
for update to authenticated
using (
  (select public.has_org_role(organization_id, array['owner']::text[]))
  or (
    role <> 'owner'
    and (select public.has_org_role(organization_id, array['admin']::text[]))
  )
)
with check (
  (select public.has_org_role(organization_id, array['owner']::text[]))
  or (
    role <> 'owner'
    and (select public.has_org_role(organization_id, array['admin']::text[]))
  )
);

-- RLS cannot redact columns. Until safe views/DTO RPCs exist, PII/internal base
-- tables are manager-only; technician/accountant/viewer access is API-only.
drop policy if exists customers_select_scoped on public.customers;
create policy customers_select_manager on public.customers
for select to authenticated
using ((select public.has_org_role(organization_id, array['owner', 'admin', 'dispatcher']::text[])));

drop policy if exists locations_select_scoped on public.locations;
create policy locations_select_manager on public.locations
for select to authenticated
using ((select public.has_org_role(organization_id, array['owner', 'admin', 'dispatcher']::text[])));

drop policy if exists assets_select_scoped on public.assets;
create policy assets_select_manager on public.assets
for select to authenticated
using ((select public.has_org_role(organization_id, array['owner', 'admin', 'dispatcher']::text[])));

drop policy if exists service_requests_select_scoped on public.service_requests;
create policy service_requests_select_manager on public.service_requests
for select to authenticated
using ((select public.has_org_role(organization_id, array['owner', 'admin', 'dispatcher']::text[])));

drop policy if exists service_request_windows_select_scoped on public.service_request_time_windows;
create policy service_request_windows_select_manager on public.service_request_time_windows
for select to authenticated
using ((select public.has_org_role(organization_id, array['owner', 'admin', 'dispatcher']::text[])));

drop policy if exists projects_select_scoped on public.projects;
create policy projects_select_manager on public.projects
for select to authenticated
using ((select public.has_org_role(organization_id, array['owner', 'admin', 'dispatcher']::text[])));

drop policy if exists work_orders_select_scoped on public.work_orders;
create policy work_orders_select_manager on public.work_orders
for select to authenticated
using ((select public.has_org_role(organization_id, array['owner', 'admin', 'dispatcher']::text[])));

drop policy if exists work_order_checklists_select_scoped on public.work_order_checklists;
drop policy if exists work_order_checklists_write_scoped on public.work_order_checklists;
create policy work_order_checklists_select_manager on public.work_order_checklists
for select to authenticated
using ((select public.has_org_role(organization_id, array['owner', 'admin', 'dispatcher']::text[])));

drop policy if exists work_order_checklist_items_select_scoped on public.work_order_checklist_items;
drop policy if exists work_order_checklist_items_write_scoped on public.work_order_checklist_items;
create policy work_order_checklist_items_select_manager on public.work_order_checklist_items
for select to authenticated
using ((select public.has_org_role(organization_id, array['owner', 'admin', 'dispatcher']::text[])));

drop policy if exists photos_select_scoped on public.photos;
drop policy if exists photos_insert_scoped on public.photos;
drop policy if exists photos_update_scoped on public.photos;
create policy photos_select_manager on public.photos
for select to authenticated
using ((select public.has_org_role(organization_id, array['owner', 'admin', 'dispatcher']::text[])));

drop policy if exists maintenance_plans_select_member on public.maintenance_plans;
create policy maintenance_plans_select_manager on public.maintenance_plans
for select to authenticated
using ((select public.has_org_role(organization_id, array['owner', 'admin', 'dispatcher']::text[])));

drop policy if exists notifications_select_scoped on public.notifications;
create policy notifications_select_manager on public.notifications
for select to authenticated
using ((select public.has_org_role(organization_id, array['owner', 'admin', 'dispatcher']::text[])));

-- Lock the parent aggregate during item edits. This serializes item changes with
-- send RPCs and closes the validate-then-send race.
create or replace function private.guard_quote_item_parent()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  parent_status text;
  target_version uuid;
  target_org uuid;
begin
  if tg_op = 'UPDATE' and new.quote_version_id is distinct from old.quote_version_id then
    raise exception using errcode = 'P0001', message = 'QUOTE_ITEM_PARENT_IMMUTABLE';
  end if;

  target_version := case when tg_op = 'DELETE' then old.quote_version_id else new.quote_version_id end;
  target_org := case when tg_op = 'DELETE' then old.organization_id else new.organization_id end;

  select qv.status into parent_status
  from public.quote_versions qv
  where qv.organization_id = target_org and qv.id = target_version
  for update;

  if parent_status is distinct from 'draft' then
    raise exception using errcode = 'P0001', message = 'QUOTE_VERSION_IMMUTABLE';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

alter function private.guard_quote_item_parent() owner to renoly_rls_owner;
revoke all on function private.guard_quote_item_parent() from public, anon, authenticated;

create or replace function private.guard_change_order_item_parent()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  parent_status text;
  target_order uuid;
  target_org uuid;
begin
  if tg_op = 'UPDATE' and new.change_order_id is distinct from old.change_order_id then
    raise exception using errcode = 'P0001', message = 'CHANGE_ORDER_ITEM_PARENT_IMMUTABLE';
  end if;

  target_order := case when tg_op = 'DELETE' then old.change_order_id else new.change_order_id end;
  target_org := case when tg_op = 'DELETE' then old.organization_id else new.organization_id end;

  select co.status into parent_status
  from public.change_orders co
  where co.organization_id = target_org and co.id = target_order
  for update;

  if parent_status is distinct from 'draft' then
    raise exception using errcode = 'P0001', message = 'CHANGE_ORDER_IMMUTABLE';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

alter function private.guard_change_order_item_parent() owner to renoly_rls_owner;
revoke all on function private.guard_change_order_item_parent() from public, anon, authenticated;

-- Snapshot and evidence rows freeze once a work order is completed/cancelled.
create or replace function private.guard_work_order_snapshot()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  target_org uuid;
  target_work_order uuid;
  parent_status text;
begin
  if tg_op = 'UPDATE' and (
    new.organization_id is distinct from old.organization_id
    or new.work_order_id is distinct from old.work_order_id
    or (
      tg_table_name = 'work_order_checklist_items'
      and (to_jsonb(new) ->> 'work_order_checklist_id')
        is distinct from (to_jsonb(old) ->> 'work_order_checklist_id')
    )
    or (
      tg_table_name = 'photos'
      and (
        (to_jsonb(new) ->> 'service_request_id')
          is distinct from (to_jsonb(old) ->> 'service_request_id')
        or (to_jsonb(new) ->> 'checklist_item_id')
          is distinct from (to_jsonb(old) ->> 'checklist_item_id')
      )
    )
  ) then
    raise exception using errcode = 'P0001', message = 'WORK_ORDER_SNAPSHOT_PARENT_IMMUTABLE';
  end if;

  target_org := case when tg_op = 'DELETE' then old.organization_id else new.organization_id end;
  target_work_order := case when tg_op = 'DELETE' then old.work_order_id else new.work_order_id end;

  select wo.status into parent_status
  from public.work_orders wo
  where wo.organization_id = target_org and wo.id = target_work_order
  for update;

  if parent_status in ('completed', 'cancelled') then
    raise exception using errcode = 'P0001', message = 'WORK_ORDER_SNAPSHOT_FROZEN';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

alter function private.guard_work_order_snapshot() owner to renoly_rls_owner;
revoke all on function private.guard_work_order_snapshot() from public, anon, authenticated;

create trigger b_guard_work_order_checklist_snapshot
before insert or update or delete on public.work_order_checklists
for each row execute function private.guard_work_order_snapshot();

create trigger b_guard_work_order_checklist_item_snapshot
before insert or update or delete on public.work_order_checklist_items
for each row execute function private.guard_work_order_snapshot();

create trigger b_guard_work_order_photo_snapshot_write
before insert or update on public.photos
for each row execute function private.guard_work_order_snapshot();

create trigger b_guard_work_order_photo_snapshot_delete
before delete on public.photos
for each row when (old.work_order_id is not null)
execute function private.guard_work_order_snapshot();

create or replace function private.require_completion_snapshot()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  if new.status = 'completed' and old.status <> 'completed' and not exists (
    select 1 from public.work_order_checklists wc
    where wc.organization_id = new.organization_id and wc.work_order_id = new.id
  ) then
    raise exception using errcode = '23514', message = 'CHECKLIST_SNAPSHOT_REQUIRED';
  end if;
  return new;
end;
$$;

alter function private.require_completion_snapshot() owner to renoly_rls_owner;
revoke all on function private.require_completion_snapshot() from public, anon, authenticated;

create trigger c_require_completion_snapshot
before update on public.work_orders
for each row execute function private.require_completion_snapshot();

-- Only response values can be changed by a field user. Required/evidence flags,
-- labels, order and actor fields remain server-owned snapshots.
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
revoke all on function public.respond_to_checklist_item(uuid, uuid, jsonb, integer) from public;
grant execute on function public.respond_to_checklist_item(uuid, uuid, jsonb, integer) to authenticated;

-- Photo rows and paths are server-generated. Authenticated users can request a
-- pending row, but cannot mark it ready or choose an arbitrary object path.
alter table public.photos
  add constraint photos_storage_path_scope_chk check (
    (
      work_order_id is not null
      and storage_path like (
        'org/' || organization_id::text || '/work-orders/' || work_order_id::text || '/' || id::text || '/%'
      )
    )
    or (
      service_request_id is not null
      and storage_path like (
        'org/' || organization_id::text || '/service-requests/' || service_request_id::text || '/' || id::text || '/%'
      )
    )
  );

create or replace function public.create_photo_upload(
  target_org uuid,
  parent_type text,
  parent_id uuid,
  photo_category text,
  original_filename text,
  declared_mime_type text,
  declared_byte_size bigint,
  declared_sha256 text,
  target_checklist_item_id uuid default null,
  target_caption text default null,
  target_captured_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  photo_id uuid := gen_random_uuid();
  object_path text;
  actor_membership uuid;
begin
  if parent_type is null
     or parent_type not in ('work_order', 'service_request')
     or parent_id is null
     or photo_category is null
     or photo_category not in ('intake', 'before', 'after', 'issue', 'receipt', 'signature', 'other')
     or nullif(btrim(original_filename), '') is null
     or char_length(original_filename) > 200
     or declared_mime_type is null
     or declared_mime_type not in ('image/jpeg', 'image/png', 'image/webp')
     or declared_byte_size is null
     or declared_byte_size not between 1 and 10485760
     or declared_sha256 is null
     or declared_sha256 !~ '^[0-9a-f]{64}$'
     or (target_caption is not null and char_length(target_caption) > 1000)
     or (target_captured_at is not null and not isfinite(target_captured_at))
     or (target_checklist_item_id is not null and parent_type <> 'work_order') then
    raise exception using errcode = '22023', message = 'PHOTO_UPLOAD_DECLARATION_INVALID';
  end if;

  if parent_type = 'work_order' then
    if not public.has_org_role(target_org, array['owner', 'admin', 'dispatcher']::text[])
       and not public.is_assigned_to_work_order(target_org, parent_id) then
      raise exception using errcode = '42501', message = 'FORBIDDEN';
    end if;
    if not exists (
      select 1 from public.work_orders wo
      where wo.organization_id = target_org and wo.id = parent_id
        and wo.status in ('scheduled', 'dispatched', 'en_route', 'on_site', 'paused')
    ) then
      raise exception using errcode = '23514', message = 'WORK_ORDER_NOT_UPLOADABLE';
    end if;
    if target_checklist_item_id is not null and not exists (
      select 1 from public.work_order_checklist_items ci
      where ci.organization_id = target_org
        and ci.work_order_id = parent_id
        and ci.id = target_checklist_item_id
    ) then
      raise exception using errcode = 'P0002', message = 'CHECKLIST_ITEM_NOT_FOUND';
    end if;
    object_path := 'org/' || target_org::text || '/work-orders/' || parent_id::text || '/' || photo_id::text || '/upload';
  else
    if not public.has_org_role(target_org, array['owner', 'admin', 'dispatcher']::text[]) then
      raise exception using errcode = '42501', message = 'FORBIDDEN';
    end if;
    if not exists (
      select 1 from public.service_requests sr
      where sr.organization_id = target_org and sr.id = parent_id
    ) then
      raise exception using errcode = 'P0002', message = 'SERVICE_REQUEST_NOT_FOUND';
    end if;
    object_path := 'org/' || target_org::text || '/service-requests/' || parent_id::text || '/' || photo_id::text || '/upload';
  end if;

  select m.id into actor_membership
  from public.memberships m
  where m.organization_id = target_org
    and m.user_id = (select private.current_actor_user_id())
    and m.status = 'active';

  insert into public.photos (
    id, organization_id, service_request_id, work_order_id, checklist_item_id, category, status,
    storage_path, original_filename, mime_type, byte_size,
    sha256, caption, captured_at, uploaded_by_membership_id, created_by, updated_by
  ) values (
    photo_id, target_org,
    case when parent_type = 'service_request' then parent_id else null end,
    case when parent_type = 'work_order' then parent_id else null end,
    target_checklist_item_id,
    photo_category, 'pending', object_path, original_filename,
    declared_mime_type, declared_byte_size, declared_sha256,
    coalesce(target_caption, ''), target_captured_at, actor_membership,
    (select private.current_actor_user_id()), (select private.current_actor_user_id())
  );

  return jsonb_build_object(
    'photoId', photo_id,
    'storagePath', object_path,
    'status', 'pending',
    'uploadExpiresInSeconds', 600
  );
end;
$$;

alter function public.create_photo_upload(uuid, text, uuid, text, text, text, bigint, text, uuid, text, timestamptz)
  owner to renoly_rls_owner;
revoke all on function public.create_photo_upload(uuid, text, uuid, text, text, text, bigint, text, uuid, text, timestamptz)
  from public;
grant execute on function public.create_photo_upload(uuid, text, uuid, text, text, text, bigint, text, uuid, text, timestamptz)
  to authenticated;

-- User-scoped transition wrapper. The raw mutator is hidden; this allowlisted DTO
-- path keeps the real JWT actor for RLS/audit and enforces occurredAt in SQL.
create or replace function public.transition_work_order_safe(
  target_org uuid,
  target_work_order uuid,
  target_status text,
  expected_lock_version integer,
  target_occurred_at timestamptz,
  reason text default null,
  completion_summary text default null,
  target_correction_reason text default null,
  target_request_id uuid default null,
  target_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  result_record public.work_orders%rowtype;
begin
  result_record := public.transition_work_order(
    target_org, target_work_order, target_status, expected_lock_version, target_occurred_at,
    reason, completion_summary, target_correction_reason, target_request_id, target_idempotency_key
  );

  return jsonb_build_object(
    'id', result_record.id,
    'workOrderNo', result_record.work_order_no,
    'projectId', result_record.project_id,
    'serviceRequestId', result_record.service_request_id,
    'customerId', result_record.customer_id,
    'locationId', result_record.location_id,
    'assetId', result_record.asset_id,
    'title', result_record.title,
    'description', result_record.description,
    'status', result_record.status,
    'priority', result_record.priority,
    'scheduledStartAt', result_record.scheduled_start_at,
    'scheduledEndAt', result_record.scheduled_end_at,
    'actualStartAt', result_record.on_site_at,
    'completedAt', result_record.completed_at,
    'customerNotes', result_record.customer_notes,
    'technicianNotes', result_record.technician_notes,
    'lockVersion', result_record.lock_version,
    'createdAt', result_record.created_at,
    'updatedAt', result_record.updated_at
  );
end;
$$;

alter function public.transition_work_order_safe(uuid, uuid, text, integer, timestamptz, text, text, text, uuid, text)
  owner to renoly_rls_owner;
revoke all on function public.transition_work_order(uuid, uuid, text, integer, timestamptz, text, text, text, uuid, text)
  from authenticated;
revoke all on function public.transition_work_order_safe(uuid, uuid, text, integer, timestamptz, text, text, text, uuid, text)
  from public, anon, service_role;
grant execute on function public.transition_work_order_safe(uuid, uuid, text, integer, timestamptz, text, text, text, uuid, text)
  to authenticated;

-- Public token shapes are resource-scoped. Only the service-role API can insert
-- or atomically consume a pre-hashed capability token.
alter table public.public_access_tokens
  add constraint public_access_tokens_scope_allowlist_chk check (
    (resource_type = 'intake_form' and scopes <@ array['intake:create', 'intake:upload']::text[])
    or (resource_type = 'quote' and scopes <@ array['quote:read', 'quote:respond']::text[])
    or (resource_type = 'change_order' and scopes <@ array['change_order:read', 'change_order:respond']::text[])
    or (resource_type = 'work_order_signoff' and scopes <@ array['work_order:signoff']::text[])
  ),
  add constraint public_access_tokens_expiry_window_chk check (
    expires_at > created_at and expires_at <= created_at + interval '366 days'
  );

create or replace function private.validate_public_token_resource()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  if new.resource_type = 'intake_form' and new.resource_id <> new.organization_id then
    raise exception using errcode = '23503', message = 'PUBLIC_TOKEN_RESOURCE_NOT_FOUND';
  elsif new.resource_type = 'quote' and not exists (
    select 1 from public.quote_versions qv
    where qv.organization_id = new.organization_id
      and qv.id = new.resource_id
      and qv.status <> 'draft'
      and qv.approval_status = 'approved'
  ) then
    raise exception using errcode = '23503', message = 'PUBLIC_TOKEN_RESOURCE_NOT_FOUND';
  elsif new.resource_type = 'change_order' and not exists (
    select 1 from public.change_orders co
    where co.organization_id = new.organization_id
      and co.id = new.resource_id
      and co.status = 'sent'
  ) then
    raise exception using errcode = '23503', message = 'PUBLIC_TOKEN_RESOURCE_NOT_FOUND';
  elsif new.resource_type = 'work_order_signoff' and not exists (
    select 1 from public.work_orders wo
    where wo.organization_id = new.organization_id
      and wo.id = new.resource_id
      and wo.status in ('on_site', 'paused')
      and wo.requires_customer_signoff
      and wo.customer_signed_at is null
  ) then
    raise exception using errcode = '23503', message = 'PUBLIC_TOKEN_RESOURCE_NOT_FOUND';
  end if;
  return new;
end;
$$;

alter function private.validate_public_token_resource() owner to renoly_rls_owner;
revoke all on function private.validate_public_token_resource() from public, anon, authenticated;

create trigger validate_public_token_resource
before insert or update of organization_id, resource_type, resource_id on public.public_access_tokens
for each row execute function private.validate_public_token_resource();

create or replace function public.consume_public_access_token(
  target_token_hash bytea,
  required_scope text
)
returns table (
  token_id uuid,
  organization_id uuid,
  resource_type text,
  resource_id uuid
)
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  token_record public.public_access_tokens%rowtype;
begin
  select pat.* into token_record
  from public.public_access_tokens pat
  where pat.token_hash = target_token_hash
  for update;

  if not found
     or required_scope is null
     or token_record.revoked_at is not null
     or token_record.expires_at <= statement_timestamp()
     or not (required_scope = any(token_record.scopes))
     or not exists (
       select 1 from public.organizations o
       where o.id = token_record.organization_id and o.status = 'active'
     )
     or (
       token_record.resource_type = 'quote'
       and required_scope = 'quote:respond'
       and not exists (
         select 1 from public.quote_versions qv
         where qv.organization_id = token_record.organization_id
           and qv.id = token_record.resource_id
           and qv.status = 'sent'
           and qv.approval_status = 'approved'
           and (qv.valid_until is null or qv.valid_until >= current_date)
       )
     )
     or (
       token_record.resource_type = 'change_order'
       and required_scope = 'change_order:respond'
       and not exists (
         select 1 from public.change_orders co
         where co.organization_id = token_record.organization_id
           and co.id = token_record.resource_id
           and co.status = 'sent'
       )
     )
     or (
       token_record.resource_type = 'work_order_signoff'
       and not exists (
         select 1 from public.work_orders wo
         where wo.organization_id = token_record.organization_id
           and wo.id = token_record.resource_id
           and wo.status in ('on_site', 'paused')
           and wo.requires_customer_signoff
           and wo.customer_signed_at is null
       )
     )
     or (token_record.max_uses is not null and token_record.use_count >= token_record.max_uses) then
    raise exception using errcode = '42501', message = 'PUBLIC_TOKEN_INVALID';
  end if;

  update public.public_access_tokens pat
  set use_count = pat.use_count + 1,
      last_used_at = statement_timestamp()
  where pat.id = token_record.id;

  return query select token_record.id, token_record.organization_id,
    token_record.resource_type, token_record.resource_id;
end;
$$;

alter function public.consume_public_access_token(bytea, text) owner to renoly_rls_owner;
revoke all on function public.consume_public_access_token(bytea, text) from public, anon, authenticated;
grant execute on function public.consume_public_access_token(bytea, text) to service_role;

-- Phase 1 is API/RPC-only. Base-table grants will be reintroduced resource by
-- resource with redacted views and matching negative tests.
revoke all on all tables in schema public from authenticated, anon;
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage on schema private to service_role;
grant select, insert, update, delete on private.line_channel_credentials to service_role;
