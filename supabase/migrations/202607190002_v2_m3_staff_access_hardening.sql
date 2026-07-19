-- Renoly v2 M3 hardening: keep ordinary staff request paths on the caller's
-- authenticated session. Base tables remain closed; narrowly scoped RPCs own
-- authorization, tenant filtering, validation, optimistic locking, and audit.

------------------------------------------------------------------------------
-- Shared private guards and workspace projection
------------------------------------------------------------------------------

create or replace function private.require_pilot_manager(target_org uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $$
declare
  actor_id uuid := (select private.current_actor_user_id());
begin
  if actor_id is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;

  if not exists (
    select 1
    from public.memberships m
    join public.organizations o on o.id = m.organization_id
    where m.organization_id = target_org
      and m.user_id = actor_id
      and m.status = 'active'
      and m.role in ('owner', 'admin', 'dispatcher')
      and o.status = 'active'
  ) then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;

  return actor_id;
end;
$$;

alter function private.require_pilot_manager(uuid) owner to renoly_rls_owner;
revoke all on function private.require_pilot_manager(uuid)
  from public, anon, authenticated, service_role;

create or replace function private.pilot_service_request_workspace(
  target_org uuid,
  target_request uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $$
declare
  request_json jsonb;
  windows_json jsonb;
  photos_json jsonb;
begin
  select jsonb_build_object(
    'id', sr.id,
    'request_no', sr.request_no,
    'customer_id', sr.customer_id,
    'location_id', sr.location_id,
    'asset_id', sr.asset_id,
    'source', sr.source,
    'status', sr.status,
    'priority', sr.priority,
    'category', sr.category,
    'internal_note', sr.internal_note,
    'subject', sr.subject,
    'description', sr.description,
    'contact_name', sr.contact_name,
    'contact_phone', sr.contact_phone,
    'contact_email', sr.contact_email,
    'assigned_member_id', sr.assigned_member_id,
    'triaged_at', sr.triaged_at,
    'converted_at', sr.converted_at,
    'converted_project_id', sr.converted_project_id,
    'converted_work_order_id', sr.converted_work_order_id,
    'converted_project_no', p.project_no,
    'converted_work_order_no', wo.work_order_no,
    'decline_reason', sr.decline_reason,
    'cancellation_reason', sr.cancellation_reason,
    'original_submission', sr.original_submission,
    'summary_edited_by', sr.summary_edited_by,
    'summary_edited_at', sr.summary_edited_at,
    'lock_version', sr.lock_version,
    'created_at', sr.created_at,
    'updated_at', sr.updated_at
  )
  into request_json
  from public.service_requests sr
  left join public.projects p
    on p.organization_id = sr.organization_id
   and p.id = sr.converted_project_id
  left join public.work_orders wo
    on wo.organization_id = sr.organization_id
   and wo.id = sr.converted_work_order_id
  where sr.organization_id = target_org
    and sr.id = target_request;

  if request_json is null then
    raise exception using errcode = 'P0002', message = 'SERVICE_REQUEST_NOT_FOUND';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'starts_at', w.starts_at,
        'ends_at', w.ends_at,
        'preference_rank', w.preference_rank
      ) order by w.preference_rank
    ),
    '[]'::jsonb
  )
  into windows_json
  from public.service_request_time_windows w
  where w.organization_id = target_org
    and w.service_request_id = target_request;

  -- Only storage metadata needed by the trusted server signer leaves the DB.
  -- No object path is ever returned by an HTTP route to the browser.
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', p.id,
        'category', p.category,
        'storage_path', p.storage_path
      ) order by p.created_at, p.id
    ),
    '[]'::jsonb
  )
  into photos_json
  from public.photos p
  where p.organization_id = target_org
    and p.service_request_id = target_request
    and p.status = 'ready'
    and p.deleted_at is null;

  return jsonb_build_object(
    'request', request_json,
    'windows', windows_json,
    'photos', photos_json
  );
end;
$$;

alter function private.pilot_service_request_workspace(uuid, uuid) owner to renoly_rls_owner;
revoke all on function private.pilot_service_request_workspace(uuid, uuid)
  from public, anon, authenticated, service_role;

------------------------------------------------------------------------------
-- Request detail and content-only summary update
------------------------------------------------------------------------------

create or replace function public.get_pilot_service_request_detail(
  p_organization_id uuid,
  p_service_request_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $$
begin
  perform private.require_pilot_manager(p_organization_id);
  return private.pilot_service_request_workspace(
    p_organization_id,
    p_service_request_id
  );
end;
$$;

alter function public.get_pilot_service_request_detail(uuid, uuid) owner to renoly_rls_owner;
revoke all on function public.get_pilot_service_request_detail(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_pilot_service_request_detail(uuid, uuid)
  to authenticated;

create or replace function public.update_pilot_service_request_summary(
  p_organization_id uuid,
  p_service_request_id uuid,
  p_expected_lock_version integer,
  p_patch jsonb,
  p_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  actor_id uuid;
  current_request public.service_requests%rowtype;
  changed_fields jsonb;
begin
  actor_id := private.require_pilot_manager(p_organization_id);

  if p_expected_lock_version is null
     or p_patch is null
     or jsonb_typeof(p_patch) <> 'object'
     or p_patch = '{}'::jsonb
     or octet_length(p_patch::text) > 16384
     or exists (
       select 1 from jsonb_object_keys(p_patch) key_name
       where key_name not in (
         'subject', 'description', 'priority', 'category',
         'contactName', 'contactPhone'
       )
     )
     or (p_patch ? 'subject' and (
       jsonb_typeof(p_patch -> 'subject') <> 'string'
       or char_length(p_patch ->> 'subject') not between 1 and 160
     ))
     or (p_patch ? 'description' and (
       jsonb_typeof(p_patch -> 'description') <> 'string'
       or char_length(p_patch ->> 'description') > 10000
     ))
     or (p_patch ? 'priority' and p_patch -> 'priority' <> 'null'::jsonb and (
       jsonb_typeof(p_patch -> 'priority') <> 'string'
       or p_patch ->> 'priority' not in ('low', 'normal', 'high', 'urgent')
     ))
     or (p_patch ? 'category' and p_patch -> 'category' <> 'null'::jsonb and (
       jsonb_typeof(p_patch -> 'category') <> 'string'
       or char_length(p_patch ->> 'category') not between 1 and 100
       or p_patch ->> 'category' not in (
         'cooling', 'plumbing', 'waterproofing', 'appliance', 'cleaning',
         'painting', 'masonry', 'carpentry', 'metalwork', 'renovation',
         'general_field_service', 'out_of_scope', 'other'
       )
     ))
     or (p_patch ? 'contactName' and (
       jsonb_typeof(p_patch -> 'contactName') <> 'string'
       or char_length(p_patch ->> 'contactName') not between 1 and 120
     ))
     or (p_patch ? 'contactPhone' and p_patch -> 'contactPhone' <> 'null'::jsonb and (
       jsonb_typeof(p_patch -> 'contactPhone') <> 'string'
       or p_patch ->> 'contactPhone' !~ '^\+[1-9][0-9]{7,14}$'
     )) then
    raise exception using errcode = '22023', message = 'PILOT_VALIDATION_FAILED';
  end if;

  select * into current_request
  from public.service_requests sr
  where sr.organization_id = p_organization_id
    and sr.id = p_service_request_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'SERVICE_REQUEST_NOT_FOUND';
  end if;
  if current_request.lock_version <> p_expected_lock_version then
    raise exception using errcode = '40001', message = 'STALE_VERSION';
  end if;

  update public.service_requests sr
  set subject = case
        when p_patch ? 'subject' then p_patch ->> 'subject' else sr.subject end,
      description = case
        when p_patch ? 'description' then p_patch ->> 'description' else sr.description end,
      priority = case
        when p_patch ? 'priority' and p_patch -> 'priority' <> 'null'::jsonb
          then p_patch ->> 'priority' else sr.priority end,
      category = case
        when p_patch ? 'category' then p_patch ->> 'category' else sr.category end,
      contact_name = case
        when p_patch ? 'contactName' then p_patch ->> 'contactName' else sr.contact_name end,
      contact_phone = case
        when p_patch ? 'contactPhone' then p_patch ->> 'contactPhone' else sr.contact_phone end,
      summary_edited_by = actor_id,
      summary_edited_at = statement_timestamp(),
      updated_by = actor_id,
      lock_version = sr.lock_version + 1
  where sr.organization_id = p_organization_id
    and sr.id = p_service_request_id;

  select coalesce(jsonb_agg(key_name order by key_name), '[]'::jsonb)
  into changed_fields
  from jsonb_object_keys(p_patch) key_name;

  perform private.append_user_event(
    p_organization_id,
    'service_request',
    p_service_request_id,
    'service_request.summary_updated',
    jsonb_build_object(
      'changedFields', changed_fields,
      'previousLockVersion', p_expected_lock_version,
      'lockVersion', p_expected_lock_version + 1
    ),
    p_request_id,
    null,
    null
  );

  return private.pilot_service_request_workspace(
    p_organization_id,
    p_service_request_id
  );
end;
$$;

alter function public.update_pilot_service_request_summary(uuid, uuid, integer, jsonb, uuid)
  owner to renoly_rls_owner;
revoke all on function public.update_pilot_service_request_summary(uuid, uuid, integer, jsonb, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.update_pilot_service_request_summary(uuid, uuid, integer, jsonb, uuid)
  to authenticated;

------------------------------------------------------------------------------
-- Customer/location/asset confirmation lists
------------------------------------------------------------------------------

create or replace function public.list_pilot_customers(
  p_organization_id uuid,
  p_query text default null,
  p_limit integer default 20
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $$
declare
  result_json jsonb;
  normalized_query text := nullif(btrim(p_query), '');
begin
  perform private.require_pilot_manager(p_organization_id);
  if p_limit is null or p_limit < 1 or p_limit > 50
     or (normalized_query is not null and char_length(normalized_query) > 120) then
    raise exception using errcode = '22023', message = 'PILOT_VALIDATION_FAILED';
  end if;

  select coalesce(jsonb_agg(candidate.item order by candidate.last_contact_at desc nulls last, candidate.id desc), '[]'::jsonb)
  into result_json
  from (
    select
      c.id,
      c.last_contact_at,
      jsonb_build_object(
        'id', c.id,
        'customer_no', c.customer_no,
        'kind', c.kind,
        'name', c.name,
        'phone', c.phone,
        'email', c.email,
        'company_name', c.company_name,
        'source', c.source,
        'notes', c.notes,
        'last_contact_at', c.last_contact_at,
        'lock_version', c.lock_version,
        'created_at', c.created_at,
        'updated_at', c.updated_at
      ) item
    from public.customers c
    where c.organization_id = p_organization_id
      and c.deleted_at is null
      and (
        normalized_query is null
        or position(lower(normalized_query) in lower(c.name)) > 0
        or (c.phone is not null and position(normalized_query in c.phone) > 0)
      )
    order by c.last_contact_at desc nulls last, c.id desc
    limit p_limit
  ) candidate;

  return result_json;
end;
$$;

alter function public.list_pilot_customers(uuid, text, integer) owner to renoly_rls_owner;
revoke all on function public.list_pilot_customers(uuid, text, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.list_pilot_customers(uuid, text, integer)
  to authenticated;

create or replace function public.list_pilot_customer_locations(
  p_organization_id uuid,
  p_customer_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $$
declare
  result_json jsonb;
begin
  perform private.require_pilot_manager(p_organization_id);

  select coalesce(jsonb_agg(candidate.item order by candidate.is_default desc, candidate.id desc), '[]'::jsonb)
  into result_json
  from (
    select
      l.id,
      l.is_default,
      jsonb_build_object(
        'id', l.id,
        'customer_id', l.customer_id,
        'label', l.label,
        'contact_name', l.contact_name,
        'contact_phone', l.contact_phone,
        'postal_code', l.postal_code,
        'county', l.county,
        'district', l.district,
        'address_line', l.address_line,
        'access_notes', l.access_notes,
        'is_default', l.is_default,
        'lock_version', l.lock_version,
        'created_at', l.created_at,
        'updated_at', l.updated_at
      ) item
    from public.locations l
    where l.organization_id = p_organization_id
      and l.customer_id = p_customer_id
      and l.deleted_at is null
  ) candidate;

  return result_json;
end;
$$;

alter function public.list_pilot_customer_locations(uuid, uuid) owner to renoly_rls_owner;
revoke all on function public.list_pilot_customer_locations(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.list_pilot_customer_locations(uuid, uuid)
  to authenticated;

create or replace function public.list_pilot_customer_assets(
  p_organization_id uuid,
  p_customer_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $$
declare
  result_json jsonb;
begin
  perform private.require_pilot_manager(p_organization_id);

  select coalesce(jsonb_agg(candidate.item order by candidate.id desc), '[]'::jsonb)
  into result_json
  from (
    select
      a.id,
      jsonb_build_object(
        'id', a.id,
        'customer_id', a.customer_id,
        'location_id', a.location_id,
        'asset_no', a.asset_no,
        'asset_type', a.asset_type,
        'name', a.name,
        'brand', a.brand,
        'model', a.model,
        'serial_number', a.serial_number,
        'installed_on', a.installed_on,
        'status', a.status,
        'lock_version', a.lock_version,
        'created_at', a.created_at,
        'updated_at', a.updated_at
      ) item
    from public.assets a
    where a.organization_id = p_organization_id
      and a.customer_id = p_customer_id
      and a.deleted_at is null
  ) candidate;

  return result_json;
end;
$$;

alter function public.list_pilot_customer_assets(uuid, uuid) owner to renoly_rls_owner;
revoke all on function public.list_pilot_customer_assets(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.list_pilot_customer_assets(uuid, uuid)
  to authenticated;

------------------------------------------------------------------------------
-- Assignment picker projection
------------------------------------------------------------------------------

create or replace function public.list_pilot_assignable_members(
  p_organization_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $$
declare
  result_json jsonb;
begin
  perform private.require_pilot_manager(p_organization_id);

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', m.id,
        'display_name', m.display_name,
        'role', m.role,
        'status', m.status
      )
      order by
        case m.role
          when 'technician' then 1
          when 'dispatcher' then 2
          when 'admin' then 3
          when 'owner' then 4
          else 5
        end,
        lower(m.display_name),
        m.id
    ),
    '[]'::jsonb
  )
  into result_json
  from public.memberships m
  where m.organization_id = p_organization_id
    and m.status = 'active'
    and m.role in ('owner', 'admin', 'dispatcher', 'technician');

  return result_json;
end;
$$;

alter function public.list_pilot_assignable_members(uuid) owner to renoly_rls_owner;
revoke all on function public.list_pilot_assignable_members(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.list_pilot_assignable_members(uuid)
  to authenticated;

------------------------------------------------------------------------------
-- Append-only timeline projection (PII-heavy submission copy removed in SQL)
------------------------------------------------------------------------------

create or replace function public.list_pilot_service_request_events(
  p_organization_id uuid,
  p_service_request_id uuid,
  p_after_sequence bigint default null,
  p_limit integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $$
declare
  result_json jsonb;
begin
  perform private.require_pilot_manager(p_organization_id);
  if p_limit is null or p_limit < 1 or p_limit > 100
     or (p_after_sequence is not null and p_after_sequence < 1) then
    raise exception using errcode = '22023', message = 'PILOT_VALIDATION_FAILED';
  end if;
  if not exists (
    select 1 from public.service_requests sr
    where sr.organization_id = p_organization_id
      and sr.id = p_service_request_id
  ) then
    raise exception using errcode = 'P0002', message = 'SERVICE_REQUEST_NOT_FOUND';
  end if;

  select coalesce(jsonb_agg(candidate.item order by candidate.chain_sequence desc), '[]'::jsonb)
  into result_json
  from (
    select
      e.chain_sequence,
      jsonb_build_object(
        'id', e.id,
        'event_type', e.event_type,
        'actor_type', e.actor_type,
        'actor_user_id', e.actor_user_id,
        'occurred_at', e.occurred_at,
        'chain_sequence', e.chain_sequence,
        'payload', e.payload - 'submission'
      ) item
    from public.events e
    where e.organization_id = p_organization_id
      and e.aggregate_type = 'service_request'
      and e.aggregate_id = p_service_request_id
      and (p_after_sequence is null or e.chain_sequence < p_after_sequence)
    order by e.chain_sequence desc
    limit p_limit
  ) candidate;

  return result_json;
end;
$$;

alter function public.list_pilot_service_request_events(uuid, uuid, bigint, integer)
  owner to renoly_rls_owner;
revoke all on function public.list_pilot_service_request_events(uuid, uuid, bigint, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.list_pilot_service_request_events(uuid, uuid, bigint, integer)
  to authenticated;

------------------------------------------------------------------------------
-- Real inline customer creation for the triage decision point
------------------------------------------------------------------------------

alter table public.events drop constraint events_aggregate_type_chk;
alter table public.events add constraint events_aggregate_type_chk check (
  aggregate_type in (
    'customer', 'service_request', 'project', 'work_order', 'quote',
    'change_order', 'payment_milestone', 'maintenance_plan', 'line_channel'
  )
);

create or replace function public.create_pilot_customer(
  p_organization_id uuid,
  p_name text,
  p_phone text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  actor_id uuid;
  normalized_name text := btrim(p_name);
  normalized_phone text := nullif(btrim(p_phone), '');
  organization_timezone text;
  v_period_key text;
  sequence_value bigint;
  created_customer public.customers%rowtype;
begin
  actor_id := private.require_pilot_manager(p_organization_id);

  if nullif(normalized_name, '') is null
     or char_length(normalized_name) > 120
     or (normalized_phone is not null and normalized_phone !~ '^\+[1-9][0-9]{7,14}$') then
    raise exception using errcode = '22023', message = 'PILOT_VALIDATION_FAILED';
  end if;

  select o.timezone
  into organization_timezone
  from public.organizations o
  where o.id = p_organization_id
    and o.status = 'active';

  if organization_timezone is null then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;

  v_period_key := to_char(statement_timestamp() at time zone organization_timezone, 'YYYYMM');
  insert into public.document_sequences (
    organization_id, document_type, period_key, current_value
  ) values (p_organization_id, 'customer', v_period_key, 1)
  on conflict (organization_id, document_type, period_key)
  do update set current_value = public.document_sequences.current_value + 1,
                updated_at = statement_timestamp()
  returning current_value into sequence_value;

  insert into public.customers (
    organization_id, customer_no, kind, name, phone, source, last_contact_at,
    created_by, updated_by
  ) values (
    p_organization_id,
    'CU-' || v_period_key || '-' || lpad(sequence_value::text, 6, '0'),
    'individual', normalized_name, normalized_phone, 'manual', statement_timestamp(),
    actor_id, actor_id
  ) returning * into created_customer;

  perform private.append_user_event(
    p_organization_id,
    'customer',
    created_customer.id,
    'customer.created',
    jsonb_build_object(
      'customerNo', created_customer.customer_no,
      'source', created_customer.source
    ),
    null,
    null,
    statement_timestamp()
  );

  return jsonb_build_object(
    'id', created_customer.id,
    'customer_no', created_customer.customer_no,
    'kind', created_customer.kind,
    'name', created_customer.name,
    'phone', created_customer.phone,
    'email', created_customer.email,
    'company_name', created_customer.company_name,
    'source', created_customer.source,
    'notes', created_customer.notes,
    'last_contact_at', created_customer.last_contact_at,
    'lock_version', created_customer.lock_version,
    'created_at', created_customer.created_at,
    'updated_at', created_customer.updated_at
  );
end;
$$;

alter function public.create_pilot_customer(uuid, text, text) owner to renoly_rls_owner;
revoke all on function public.create_pilot_customer(uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.create_pilot_customer(uuid, text, text)
  to authenticated;
