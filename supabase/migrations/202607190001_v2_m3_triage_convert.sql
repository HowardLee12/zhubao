-- Renoly v2 M3: manual triage, template snapshot on conversion, and the
-- customer/location/asset confirmation surface.
--
-- This migration adds the service-request columns M3 needs (category, an
-- immutable original_submission snapshot, and summary-edit provenance), the
-- convert-once hardening indexes, a guard trigger that protects the original
-- submission, and four RPCs: triage_service_request, convert_service_request,
-- find_similar_customers, plus a keyset overload of list_pilot_service_requests.
-- The existing (uuid, integer) list overload and the status-only
-- transition_service_request primitive are left intact.

------------------------------------------------------------------------------
-- 1. Schema changes on public.service_requests
------------------------------------------------------------------------------

alter table public.service_requests
  add column category text,
  add column internal_note text not null default '',
  add column original_submission jsonb,
  add column summary_edited_by uuid references auth.users(id) on delete set null,
  add column summary_edited_at timestamptz;

alter table public.service_requests
  add constraint service_requests_category_chk check (
    category is null or category in (
      'cooling', 'plumbing', 'waterproofing', 'appliance', 'cleaning',
      'painting', 'masonry', 'carpentry', 'metalwork', 'renovation',
      'general_field_service', 'out_of_scope', 'other'
    )
  ),
  add constraint service_requests_internal_note_length_chk check (
    char_length(internal_note) <= 2000
  ),
  add constraint service_requests_original_submission_size_chk check (
    original_submission is null or octet_length(original_submission::text) <= 32768
  );

-- One-time backfill: pilot intake rows created before this migration have no
-- original_submission. Pack the current canonical contact/subject/description
-- into the immutable snapshot so the guard trigger and detail view have a
-- source-of-truth baseline. Only rows that still lack a snapshot are touched.
update public.service_requests sr
set original_submission = jsonb_build_object(
      'contactName', sr.contact_name,
      'contactPhone', sr.contact_phone,
      'contactEmail', sr.contact_email,
      'subject', sr.subject,
      'description', sr.description,
      'source', sr.source,
      'submittedAt', sr.created_at,
      'intakeSubmissionId', sr.metadata ->> 'intakeSubmissionId',
      'intakeVersion', coalesce((sr.metadata ->> 'intakeVersion')::integer, 1),
      'backfilled', true
    )
where sr.original_submission is null;

------------------------------------------------------------------------------
-- 2. Guard trigger: original_submission is write-once and then immutable
------------------------------------------------------------------------------

create or replace function private.guard_original_submission()
returns trigger
language plpgsql
set search_path = pg_catalog, public, private
as $$
begin
  -- First write (null -> value) is allowed; any later change is rejected.
  if old.original_submission is not null
     and new.original_submission is distinct from old.original_submission then
    raise exception using errcode = 'P0001', message = 'ORIGINAL_SUBMISSION_IMMUTABLE';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_original_submission() from public, anon, authenticated;

create trigger b_guard_original_submission
before update on public.service_requests
for each row execute function private.guard_original_submission();

------------------------------------------------------------------------------
-- 3. Convert-once hardening: at most one target per service request
------------------------------------------------------------------------------

create unique index service_requests_converted_project_uniq
  on public.service_requests (organization_id, converted_project_id)
  where converted_project_id is not null;

create unique index service_requests_converted_work_order_uniq
  on public.service_requests (organization_id, converted_work_order_id)
  where converted_work_order_id is not null;

------------------------------------------------------------------------------
-- 4. submit_pilot_service_request: persist original_submission + full payload
------------------------------------------------------------------------------
-- CREATE OR REPLACE with the identical signature. The only behavioural change
-- versus 202607160005 is that the service_requests insert now writes an
-- immutable original_submission snapshot, and the public_submitted event
-- payload carries the full submission (contact/subject/description/address) so
-- there is a second, append-only copy of the raw customer intent.

create or replace function public.submit_pilot_service_request(
  p_public_intake_token_hash_hex text,
  p_intake_id uuid,
  p_idempotency_key text,
  p_client_ip_hash_hex text,
  p_request_body jsonb,
  p_upload_ids uuid[] default '{}'::uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, extensions
as $$
declare
  v_token public.public_access_tokens%rowtype;
  v_ip_hash bytea;
  v_service_item_id uuid;
  v_contact_name text;
  v_contact_phone text;
  v_subject text;
  v_description text;
  v_address jsonb;
  v_windows jsonb;
  v_window jsonb;
  v_window_start timestamptz;
  v_window_end timestamptz;
  v_rank integer;
  v_seen_ranks integer[] := '{}'::integer[];
  v_upload_fingerprint text;
  v_request_hash text;
  v_actor_fingerprint text;
  v_idempotency public.idempotency_keys%rowtype;
  v_inserted integer;
  v_rate_count integer;
  v_rate_window timestamptz;
  v_customer_id uuid := gen_random_uuid();
  v_location_id uuid := gen_random_uuid();
  v_customer_sequence bigint;
  v_request_sequence bigint;
  v_period_key text;
  v_customer_no text;
  v_request_no text;
  v_org_timezone text;
  v_photo_count integer := coalesce(cardinality(p_upload_ids), 0);
  v_event_id uuid := gen_random_uuid();
  v_event_occurred timestamptz := statement_timestamp();
  v_event_recorded timestamptz;
  v_event_payload jsonb;
  v_original_submission jsonb;
  v_event_hash bytea;
  v_response jsonb;
begin
  v_token := private.require_pilot_intake_token(
    p_public_intake_token_hash_hex, 'intake:create'
  );
  v_ip_hash := private.decode_pilot_sha256_hex(
    p_client_ip_hash_hex, 'PILOT_VALIDATION_FAILED'
  );

  if p_intake_id is null
     or nullif(btrim(p_idempotency_key), '') is null
     or char_length(p_idempotency_key) not between 8 and 200
     or p_request_body is null or jsonb_typeof(p_request_body) <> 'object'
     or octet_length(p_request_body::text) > 32768
     or p_upload_ids is null
     or cardinality(p_upload_ids) > 10
     or array_position(p_upload_ids, null) is not null
     or (
       select count(*) <> count(distinct upload_id)
       from unnest(p_upload_ids) upload_id
     )
     or exists (
       select 1 from jsonb_object_keys(p_request_body) key_name
       where key_name not in (
         'serviceCatalogItemId', 'contactName', 'contactPhone',
         'subject', 'description', 'address', 'preferredWindows'
       )
     ) then
    raise exception using errcode = '22023', message = 'PILOT_VALIDATION_FAILED';
  end if;

  begin
    v_service_item_id := (p_request_body ->> 'serviceCatalogItemId')::uuid;
  exception when invalid_text_representation then
    raise exception using errcode = '22023', message = 'PILOT_VALIDATION_FAILED';
  end;

  v_contact_name := btrim(p_request_body ->> 'contactName');
  v_contact_phone := btrim(p_request_body ->> 'contactPhone');
  v_subject := btrim(p_request_body ->> 'subject');
  v_description := coalesce(p_request_body ->> 'description', '');
  v_address := p_request_body -> 'address';
  v_windows := coalesce(p_request_body -> 'preferredWindows', '[]'::jsonb);

  if v_service_item_id is null
     or nullif(v_contact_name, '') is null or char_length(v_contact_name) > 120
     or v_contact_phone is null or v_contact_phone !~ '^\+[1-9][0-9]{7,14}$'
     or nullif(v_subject, '') is null or char_length(v_subject) > 160
     or char_length(v_description) > 10000
     or v_address is null or jsonb_typeof(v_address) <> 'object'
     or exists (
       select 1 from jsonb_object_keys(v_address) key_name
       where key_name not in (
         'postalCode', 'county', 'district', 'addressLine', 'accessNotes'
       )
     )
     or jsonb_typeof(v_address -> 'addressLine') <> 'string'
     or char_length(btrim(v_address ->> 'addressLine')) not between 1 and 300
     or (v_address ? 'postalCode' and (
       jsonb_typeof(v_address -> 'postalCode') <> 'string'
       or char_length(v_address ->> 'postalCode') > 12
     ))
     or (v_address ? 'county' and (
       jsonb_typeof(v_address -> 'county') <> 'string'
       or char_length(v_address ->> 'county') > 80
     ))
     or (v_address ? 'district' and (
       jsonb_typeof(v_address -> 'district') <> 'string'
       or char_length(v_address ->> 'district') > 80
     ))
     or (v_address ? 'accessNotes' and (
       jsonb_typeof(v_address -> 'accessNotes') <> 'string'
       or char_length(v_address ->> 'accessNotes') > 2000
     ))
     or jsonb_typeof(v_windows) <> 'array'
     or jsonb_array_length(v_windows) > 5 then
    raise exception using errcode = '22023', message = 'PILOT_VALIDATION_FAILED';
  end if;

  for v_window in select value from jsonb_array_elements(v_windows)
  loop
    if jsonb_typeof(v_window) <> 'object'
       or exists (
         select 1 from jsonb_object_keys(v_window) key_name
         where key_name not in ('startsAt', 'endsAt', 'preferenceRank')
       )
       or jsonb_typeof(v_window -> 'startsAt') <> 'string'
       or jsonb_typeof(v_window -> 'endsAt') <> 'string'
       or jsonb_typeof(v_window -> 'preferenceRank') <> 'number'
       or (v_window ->> 'preferenceRank') !~ '^[1-5]$' then
      raise exception using errcode = '22023', message = 'PILOT_VALIDATION_FAILED';
    end if;
    begin
      v_window_start := (v_window ->> 'startsAt')::timestamptz;
      v_window_end := (v_window ->> 'endsAt')::timestamptz;
      v_rank := (v_window ->> 'preferenceRank')::integer;
    exception when invalid_datetime_format or datetime_field_overflow then
      raise exception using errcode = '22023', message = 'PILOT_VALIDATION_FAILED';
    end;
    if not isfinite(v_window_start) or not isfinite(v_window_end)
       or v_window_end <= v_window_start
       or v_rank = any(v_seen_ranks) then
      raise exception using errcode = '22023', message = 'PILOT_VALIDATION_FAILED';
    end if;
    v_seen_ranks := array_append(v_seen_ranks, v_rank);
  end loop;

  select coalesce(string_agg(upload_id::text, ',' order by upload_id), '')
  into v_upload_fingerprint
  from unnest(p_upload_ids) upload_id;
  v_request_hash := encode(
    extensions.digest(
      p_intake_id::text || '|' || p_request_body::text || '|' || v_upload_fingerprint,
      'sha256'
    ),
    'hex'
  );
  v_actor_fingerprint := 'pilot:' || v_token.id::text || ':' || encode(v_ip_hash, 'hex');

  insert into public.idempotency_keys (
    organization_id, actor_fingerprint, method, path_template,
    idempotency_key, request_hash, state, resource_type, resource_id,
    locked_until, expires_at
  ) values (
    v_token.organization_id, v_actor_fingerprint, 'POST', '/api/v2/public/intake/submit',
    p_idempotency_key, v_request_hash, 'processing', 'service_request', p_intake_id,
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
      and path_template = '/api/v2/public/intake/submit'
      and idempotency_key = p_idempotency_key
    for update;

    if v_idempotency.request_hash is distinct from v_request_hash then
      raise exception using errcode = '22023', message = 'PILOT_IDEMPOTENCY_CONFLICT';
    end if;
    if v_idempotency.state = 'completed' and v_idempotency.response_body is not null then
      return v_idempotency.response_body;
    end if;
    raise exception using errcode = '22023', message = 'PILOT_IDEMPOTENCY_CONFLICT';
  end if;

  perform 1
  from public.service_catalog_items sci
  join public.service_catalogs sc
    on sc.organization_id = sci.organization_id and sc.id = sci.service_catalog_id
  where sci.organization_id = v_token.organization_id
    and sci.id = v_service_item_id
    and sci.is_active and sc.is_active and sc.is_default;
  if not found then
    raise exception using errcode = '42501', message = 'PILOT_SERVICE_NOT_AVAILABLE';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('pilot-intake:' || p_intake_id::text, 0)
  );
  if exists (
       select 1 from private.pilot_intake_uploads u
       where u.intake_id = p_intake_id
         and (
           u.organization_id <> v_token.organization_id
           or u.token_id <> v_token.id
           or u.ip_hash <> v_ip_hash
         )
     ) then
    raise exception using errcode = '42501', message = 'PILOT_UPLOAD_INVALID';
  end if;
  if exists (select 1 from public.service_requests where id = p_intake_id)
     or exists (
       select 1 from public.events e
       where e.organization_id = v_token.organization_id
         and e.aggregate_type = 'service_request'
         and e.aggregate_id = p_intake_id
     ) then
    raise exception using errcode = '23505', message = 'PILOT_INTAKE_SESSION_CONFLICT';
  end if;

  if v_photo_count > 0 then
    perform 1
    from private.pilot_intake_uploads u
    where u.id = any(p_upload_ids)
    order by u.id
    for update;

    if (
      select count(*)::integer
      from private.pilot_intake_uploads u
      where u.id = any(p_upload_ids)
        and u.organization_id = v_token.organization_id
        and u.token_id = v_token.id
        and u.intake_id = p_intake_id
        and u.ip_hash = v_ip_hash
        and u.status = 'ready'
        and u.consumed_at is null
        and u.expires_at > statement_timestamp()
    ) <> v_photo_count then
      raise exception using errcode = '42501', message = 'PILOT_UPLOAD_INVALID';
    end if;
  end if;

  v_rate_window := date_bin(
    interval '15 minutes', statement_timestamp(), timestamptz '2001-01-01 00:00:00+00'
  );
  insert into private.pilot_intake_rate_limits (
    organization_id, token_id, ip_hash, action, window_started_at, request_count
  ) values (
    v_token.organization_id, v_token.id, v_ip_hash, 'submit', v_rate_window, 1
  )
  on conflict (token_id, ip_hash, action, window_started_at)
  do update set request_count = private.pilot_intake_rate_limits.request_count + 1,
                updated_at = clock_timestamp()
  returning request_count into v_rate_count;
  if v_rate_count > 5 then
    raise exception using errcode = 'P0001', message = 'PILOT_RATE_LIMITED';
  end if;

  select timezone into v_org_timezone
  from public.organizations where id = v_token.organization_id;
  v_period_key := to_char(statement_timestamp() at time zone v_org_timezone, 'YYYYMM');

  insert into public.document_sequences (
    organization_id, document_type, period_key, current_value
  ) values (v_token.organization_id, 'customer', v_period_key, 1)
  on conflict (organization_id, document_type, period_key)
  do update set current_value = public.document_sequences.current_value + 1,
                updated_at = statement_timestamp()
  returning current_value into v_customer_sequence;

  insert into public.document_sequences (
    organization_id, document_type, period_key, current_value
  ) values (v_token.organization_id, 'request', v_period_key, 1)
  on conflict (organization_id, document_type, period_key)
  do update set current_value = public.document_sequences.current_value + 1,
                updated_at = statement_timestamp()
  returning current_value into v_request_sequence;

  v_customer_no := 'CU-' || v_period_key || '-' || lpad(v_customer_sequence::text, 6, '0');
  v_request_no := 'SR-' || v_period_key || '-' || lpad(v_request_sequence::text, 6, '0');

  insert into public.customers (
    id, organization_id, customer_no, kind, name, phone, source, last_contact_at
  ) values (
    v_customer_id, v_token.organization_id, v_customer_no, 'individual',
    v_contact_name, v_contact_phone, 'web', statement_timestamp()
  );

  insert into public.locations (
    id, organization_id, customer_id, label, contact_name, contact_phone,
    postal_code, county, district, address_line, access_notes, is_default
  ) values (
    v_location_id, v_token.organization_id, v_customer_id, '報修地址',
    v_contact_name, v_contact_phone,
    nullif(btrim(v_address ->> 'postalCode'), ''),
    nullif(btrim(v_address ->> 'county'), ''),
    nullif(btrim(v_address ->> 'district'), ''),
    btrim(v_address ->> 'addressLine'),
    coalesce(v_address ->> 'accessNotes', ''), true
  );

  v_original_submission := jsonb_build_object(
    'contactName', v_contact_name,
    'contactPhone', v_contact_phone,
    'subject', v_subject,
    'description', v_description,
    'address', v_address,
    'preferredWindows', v_windows,
    'source', 'web',
    'submittedAt', v_event_occurred,
    'intakeSubmissionId', p_intake_id,
    'intakeVersion', 1,
    'serviceCatalogItemId', v_service_item_id
  );

  insert into public.service_requests (
    id, organization_id, request_no, customer_id, location_id, source,
    source_reference, contact_name, contact_phone, subject, description,
    priority, status, original_submission, metadata
  ) values (
    p_intake_id, v_token.organization_id, v_request_no, v_customer_id, v_location_id,
    'web', 'pilot-intake:' || p_intake_id::text, v_contact_name, v_contact_phone,
    v_subject, v_description, 'normal', 'new', v_original_submission,
    jsonb_build_object(
      'serviceCatalogItemId', v_service_item_id,
      'intakeSubmissionId', p_intake_id,
      'intakeVersion', 1
    )
  );

  for v_window in select value from jsonb_array_elements(v_windows)
  loop
    insert into public.service_request_time_windows (
      organization_id, service_request_id, starts_at, ends_at, preference_rank
    ) values (
      v_token.organization_id, p_intake_id,
      (v_window ->> 'startsAt')::timestamptz,
      (v_window ->> 'endsAt')::timestamptz,
      (v_window ->> 'preferenceRank')::smallint
    );
  end loop;

  if v_photo_count > 0 then
    insert into public.photos (
      id, organization_id, service_request_id, category, status,
      storage_path, original_filename, mime_type, byte_size,
      width, height, sha256, ready_at
    )
    select
      u.id, u.organization_id, p_intake_id, 'intake', 'ready',
      u.storage_path, u.original_filename, u.actual_mime_type, u.actual_byte_size,
      u.image_width, u.image_height, u.actual_sha256, u.ready_at
    from private.pilot_intake_uploads u
    where u.id = any(p_upload_ids);

    update private.pilot_intake_uploads
    set status = 'consumed', consumed_at = clock_timestamp(), service_request_id = p_intake_id
    where id = any(p_upload_ids);
  end if;

  v_event_recorded := clock_timestamp();
  -- Full payload lives in the append-only event as a second copy of raw intent.
  v_event_payload := jsonb_build_object(
    'requestNo', v_request_no,
    'source', 'web',
    'serviceCatalogItemId', v_service_item_id,
    'photoCount', v_photo_count,
    'submission', v_original_submission
  );
  v_event_hash := extensions.digest(
    '|' || v_token.organization_id::text || '|service_request|' || p_intake_id::text
    || '|service_request.public_submitted|system|' || v_event_occurred::text
    || '|' || v_event_recorded::text || '|1|' || v_event_payload::text,
    'sha256'
  );
  insert into public.events (
    id, organization_id, aggregate_type, aggregate_id, event_type,
    actor_type, occurred_at, recorded_at, chain_sequence, request_id,
    idempotency_key, payload, prev_hash, event_hash
  ) values (
    v_event_id, v_token.organization_id, 'service_request', p_intake_id,
    'service_request.public_submitted', 'system', v_event_occurred, v_event_recorded,
    1, p_intake_id, p_idempotency_key, v_event_payload, null, v_event_hash
  );

  update public.public_access_tokens
  set use_count = use_count + 1,
      last_used_at = statement_timestamp()
  where id = v_token.id
    and revoked_at is null
    and expires_at > statement_timestamp()
    and (max_uses is null or use_count < max_uses);
  get diagnostics v_inserted = row_count;
  if v_inserted <> 1 then
    raise exception using errcode = '42501', message = 'PILOT_PUBLIC_LINK_NOT_FOUND';
  end if;

  v_response := jsonb_build_object(
    'serviceRequestId', p_intake_id,
    'requestNo', v_request_no,
    'status', 'new',
    'createdAt', v_event_occurred
  );
  update public.idempotency_keys
  set state = 'completed', response_status = 201, response_body = v_response,
      locked_until = null
  where id = v_idempotency.id;

  return v_response;
end;
$$;

alter function public.submit_pilot_service_request(text, uuid, text, text, jsonb, uuid[])
  owner to renoly_rls_owner;
revoke all on function public.submit_pilot_service_request(text, uuid, text, text, jsonb, uuid[])
  from public, anon, authenticated;
grant execute on function public.submit_pilot_service_request(text, uuid, text, text, jsonb, uuid[])
  to service_role;

------------------------------------------------------------------------------
-- 5. triage_service_request RPC
------------------------------------------------------------------------------
-- Binds a service request to a customer (relinking any provisional intake
-- customer), optionally to a location/asset, records an assignee/priority/
-- category, and moves new -> triaged (re-triage of a triaged row is allowed so
-- staff can bind a location or asset later). original_submission is never
-- touched here; the guard trigger enforces that invariant.

create or replace function public.triage_service_request(
  target_org uuid,
  target_request uuid,
  expected_lock_version integer,
  p_customer_id uuid,
  p_location_id uuid default null,
  p_asset_id uuid default null,
  p_assigned_member_id uuid default null,
  p_priority text default null,
  p_category text default null,
  p_internal_note text default null,
  target_request_id uuid default null
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

  if not (current_record.status in ('new', 'triaged')) then
    raise exception using errcode = '23514', message = 'INVALID_SERVICE_REQUEST_TRANSITION';
  end if;

  -- Customer is mandatory for triage.
  if p_customer_id is null then
    raise exception using errcode = '23514', message = 'TRIAGE_REQUIRES_CUSTOMER';
  end if;
  if not exists (
    select 1 from public.customers c
    where c.organization_id = target_org and c.id = p_customer_id and c.deleted_at is null
  ) then
    raise exception using errcode = '23503', message = 'CUSTOMER_NOT_IN_ORG';
  end if;

  -- Location, when supplied, must belong to the same customer.
  if p_location_id is not null then
    if not exists (
      select 1 from public.locations l
      where l.organization_id = target_org
        and l.id = p_location_id
        and l.customer_id = p_customer_id
        and l.deleted_at is null
    ) then
      raise exception using errcode = '23503', message = 'LOCATION_CUSTOMER_MISMATCH';
    end if;
  end if;

  -- Asset, when supplied, must be scoped to the same customer (and location if
  -- one is bound). An asset always has a location, so a location is required.
  if p_asset_id is not null then
    if p_location_id is null then
      raise exception using errcode = '23503', message = 'ASSET_SCOPE_MISMATCH';
    end if;
    if not exists (
      select 1 from public.assets a
      where a.organization_id = target_org
        and a.id = p_asset_id
        and a.customer_id = p_customer_id
        and a.location_id = p_location_id
        and a.deleted_at is null
    ) then
      raise exception using errcode = '23503', message = 'ASSET_SCOPE_MISMATCH';
    end if;
  end if;

  -- Assignee, when supplied, must be an active operational membership. Billing
  -- and read-only roles may inspect according to their own surfaces but cannot
  -- become the responsible field worker for a service request.
  if p_assigned_member_id is not null then
    if not exists (
      select 1 from public.memberships m
      where m.organization_id = target_org
        and m.id = p_assigned_member_id
        and m.status = 'active'
    ) then
      raise exception using errcode = '23503', message = 'MEMBER_NOT_ACTIVE';
    end if;
    if not exists (
      select 1 from public.memberships m
      where m.organization_id = target_org
        and m.id = p_assigned_member_id
        and m.role in ('owner', 'admin', 'dispatcher', 'technician')
    ) then
      raise exception using errcode = '23503', message = 'MEMBER_NOT_ASSIGNABLE';
    end if;
  end if;

  if p_priority is not null and p_priority not in ('low', 'normal', 'high', 'urgent') then
    raise exception using errcode = '23514', message = 'INVALID_PRIORITY';
  end if;
  if p_category is not null and p_category not in (
    'cooling', 'plumbing', 'waterproofing', 'appliance', 'cleaning',
    'painting', 'masonry', 'carpentry', 'metalwork', 'renovation',
    'general_field_service', 'out_of_scope', 'other'
  ) then
    raise exception using errcode = '23514', message = 'INVALID_CATEGORY';
  end if;
  if p_internal_note is not null and char_length(p_internal_note) > 2000 then
    raise exception using errcode = '22023', message = 'PILOT_VALIDATION_FAILED';
  end if;

  update public.service_requests
  set customer_id = p_customer_id,
      location_id = p_location_id,
      asset_id = p_asset_id,
      assigned_member_id = coalesce(p_assigned_member_id, assigned_member_id),
      priority = coalesce(p_priority, priority),
      category = coalesce(p_category, category),
      internal_note = coalesce(p_internal_note, internal_note),
      status = 'triaged',
      triaged_at = coalesce(triaged_at, statement_timestamp()),
      updated_by = (select private.current_actor_user_id()),
      lock_version = lock_version + 1
  where organization_id = target_org and id = target_request
  returning * into result_record;

  perform private.append_user_event(
    target_org, 'service_request', target_request,
    'service_request.triaged',
    jsonb_build_object(
      'from', current_record.status,
      'to', 'triaged',
      'customerId', p_customer_id,
      'locationId', p_location_id,
      'assetId', p_asset_id,
      'assignedMemberId', p_assigned_member_id,
      'priority', result_record.priority,
      'category', result_record.category,
      'internalNoteChanged', p_internal_note is not null
    ),
    target_request_id, null
  );

  return result_record;
end;
$$;

alter function public.triage_service_request(uuid, uuid, integer, uuid, uuid, uuid, uuid, text, text, text, uuid)
  owner to renoly_rls_owner;
revoke all on function public.triage_service_request(uuid, uuid, integer, uuid, uuid, uuid, uuid, text, text, text, uuid)
  from public;
grant execute on function public.triage_service_request(uuid, uuid, integer, uuid, uuid, uuid, uuid, text, text, text, uuid)
  to authenticated;

------------------------------------------------------------------------------
-- 6. convert_service_request RPC
------------------------------------------------------------------------------
-- Converts a triaged/quoting/quoted request into a work order (and, in project
-- mode, a project). Copies the service catalog item (name -> title, spec ->
-- description) and its checklist template (by value) into the work order.
-- Idempotent: converting an already-converted request returns the existing
-- envelope instead of creating a second target.

create or replace function public.convert_service_request(
  target_org uuid,
  target_request uuid,
  expected_lock_version integer,
  p_mode text,
  p_project_title text default null,
  p_work_order jsonb default null,
  target_request_id uuid default null,
  target_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  current_record public.service_requests%rowtype;
  result_record public.service_requests%rowtype;
  v_catalog_item public.service_catalog_items%rowtype;
  v_service_item_id uuid;
  v_project_id uuid;
  v_work_order_id uuid := gen_random_uuid();
  v_new_checklist_id uuid;
  v_project_no text;
  v_work_order_no text;
  v_period_key text;
  v_org_timezone text;
  v_seq bigint;
  v_wo_title text;
  v_wo_description text;
  v_project_title text;
  v_wo_scheduled_start timestamptz;
  v_wo_scheduled_end timestamptz;
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

  -- Idempotent replay: an already-converted request returns the existing case.
  if current_record.status = 'converted' then
    return jsonb_build_object(
      'serviceRequest', jsonb_build_object(
        'id', current_record.id,
        'status', current_record.status,
        'lockVersion', current_record.lock_version,
        'convertedAt', current_record.converted_at
      ),
      'project', case
        when current_record.converted_project_id is null then null
        else (
          select jsonb_build_object('id', p.id, 'projectNo', p.project_no, 'name', p.name, 'status', p.status)
          from public.projects p
          where p.organization_id = target_org and p.id = current_record.converted_project_id
        )
      end,
      'workOrder', case
        when current_record.converted_work_order_id is null then null
        else (
          select jsonb_build_object('id', w.id, 'workOrderNo', w.work_order_no, 'title', w.title, 'status', w.status)
          from public.work_orders w
          where w.organization_id = target_org and w.id = current_record.converted_work_order_id
        )
      end,
      'replayed', true
    );
  end if;

  if current_record.lock_version is distinct from expected_lock_version then
    raise exception using errcode = '40001', message = 'STALE_VERSION';
  end if;

  if not (current_record.status in ('triaged', 'quoting', 'quoted')) then
    raise exception using errcode = '23514', message = 'INVALID_SERVICE_REQUEST_TRANSITION';
  end if;
  if current_record.customer_id is null then
    raise exception using errcode = '23514', message = 'TRIAGE_REQUIRES_CUSTOMER';
  end if;
  if current_record.location_id is null then
    raise exception using errcode = '23514', message = 'CONVERSION_TARGET_REQUIRED';
  end if;
  if p_mode is null or p_mode not in ('singleVisit', 'project') then
    raise exception using errcode = '23514', message = 'INVALID_CONVERSION_MODE';
  end if;

  select timezone into v_org_timezone
  from public.organizations where id = target_org;
  v_period_key := to_char(statement_timestamp() at time zone coalesce(v_org_timezone, 'UTC'), 'YYYYMM');

  -- Snapshot source: the service catalog item captured at intake time.
  v_service_item_id := nullif(current_record.metadata ->> 'serviceCatalogItemId', '')::uuid;
  if v_service_item_id is not null then
    select * into v_catalog_item
    from public.service_catalog_items sci
    where sci.organization_id = target_org and sci.id = v_service_item_id;
  end if;

  v_wo_title := coalesce(
    nullif(btrim(p_work_order ->> 'title'), ''),
    nullif(v_catalog_item.name, ''),
    left(current_record.subject, 160)
  );
  v_wo_description := coalesce(nullif(v_catalog_item.specification, ''), '');

  if p_work_order ? 'scheduledStartAt' and jsonb_typeof(p_work_order -> 'scheduledStartAt') = 'string' then
    v_wo_scheduled_start := (p_work_order ->> 'scheduledStartAt')::timestamptz;
  end if;
  if p_work_order ? 'scheduledEndAt' and jsonb_typeof(p_work_order -> 'scheduledEndAt') = 'string' then
    v_wo_scheduled_end := (p_work_order ->> 'scheduledEndAt')::timestamptz;
  end if;
  -- A schedule is only honoured when both endpoints are present and ordered;
  -- otherwise the work order starts in draft with no schedule.
  if v_wo_scheduled_start is null or v_wo_scheduled_end is null
     or v_wo_scheduled_end <= v_wo_scheduled_start then
    v_wo_scheduled_start := null;
    v_wo_scheduled_end := null;
  end if;

  -- Project mode creates a project target first so the work order can hang off it.
  if p_mode = 'project' then
    v_project_id := gen_random_uuid();
    v_seq := public.next_document_number(target_org, 'project', v_period_key);
    v_project_no := 'PJ-' || v_period_key || '-' || lpad(v_seq::text, 6, '0');
    v_project_title := coalesce(
      nullif(btrim(p_project_title), ''),
      left(current_record.subject, 160)
    );
    insert into public.projects (
      id, organization_id, project_no, customer_id, location_id,
      service_request_id, name, status, created_by, updated_by
    ) values (
      v_project_id, target_org, v_project_no, current_record.customer_id,
      current_record.location_id, target_request, v_project_title, 'active',
      (select private.current_actor_user_id()), (select private.current_actor_user_id())
    );
  end if;

  v_seq := public.next_document_number(target_org, 'work_order', v_period_key);
  v_work_order_no := 'WO-' || v_period_key || '-' || lpad(v_seq::text, 6, '0');

  insert into public.work_orders (
    id, organization_id, work_order_no, project_id, service_request_id,
    customer_id, location_id, asset_id, service_catalog_item_id,
    title, description, priority, status, scheduled_start_at, scheduled_end_at,
    created_by, updated_by
  ) values (
    v_work_order_id, target_org, v_work_order_no, v_project_id, target_request,
    current_record.customer_id, current_record.location_id, current_record.asset_id,
    v_service_item_id, v_wo_title, v_wo_description, current_record.priority,
    case when v_wo_scheduled_start is not null then 'scheduled' else 'draft' end,
    v_wo_scheduled_start, v_wo_scheduled_end,
    (select private.current_actor_user_id()), (select private.current_actor_user_id())
  );

  -- Checklist snapshot: copy the catalog item's checklist template by value.
  if v_catalog_item.checklist_template_id is not null then
    v_new_checklist_id := gen_random_uuid();
    insert into public.work_order_checklists (
      id, organization_id, work_order_id, source_template_id, name, status,
      created_by, updated_by
    )
    select
      v_new_checklist_id, target_org, v_work_order_id, ct.id, ct.name, 'pending',
      (select private.current_actor_user_id()), (select private.current_actor_user_id())
    from public.checklist_templates ct
    where ct.organization_id = target_org and ct.id = v_catalog_item.checklist_template_id;

    insert into public.work_order_checklist_items (
      organization_id, work_order_checklist_id, work_order_id,
      source_template_item_id, label, response_type, is_required,
      evidence_required, options, sort_order
    )
    select
      target_org, v_new_checklist_id, v_work_order_id,
      cti.id, cti.label, cti.response_type, cti.is_required,
      cti.evidence_required, cti.options, cti.sort_order
    from public.checklist_template_items cti
    where cti.organization_id = target_org
      and cti.checklist_template_id = v_catalog_item.checklist_template_id
    order by cti.sort_order;
  end if;

  update public.service_requests
  set status = 'converted',
      converted_at = statement_timestamp(),
      converted_project_id = v_project_id,
      converted_work_order_id = v_work_order_id,
      updated_by = (select private.current_actor_user_id()),
      lock_version = lock_version + 1
  where organization_id = target_org and id = target_request
  returning * into result_record;

  perform private.append_user_event(
    target_org, 'service_request', target_request,
    'service_request.converted',
    jsonb_build_object(
      'projectId', v_project_id,
      'workOrderId', v_work_order_id,
      'mode', p_mode,
      'serviceCatalogItemId', v_service_item_id
    ),
    target_request_id, target_idempotency_key
  );

  return jsonb_build_object(
    'serviceRequest', jsonb_build_object(
      'id', result_record.id,
      'status', result_record.status,
      'lockVersion', result_record.lock_version,
      'convertedAt', result_record.converted_at
    ),
    'project', case
      when v_project_id is null then null
      else (
        select jsonb_build_object('id', p.id, 'projectNo', p.project_no, 'name', p.name, 'status', p.status)
        from public.projects p
        where p.organization_id = target_org and p.id = v_project_id
      )
    end,
    'workOrder', (
      select jsonb_build_object('id', w.id, 'workOrderNo', w.work_order_no, 'title', w.title, 'status', w.status)
      from public.work_orders w
      where w.organization_id = target_org and w.id = v_work_order_id
    ),
    'replayed', false
  );
end;
$$;

alter function public.convert_service_request(uuid, uuid, integer, text, text, jsonb, uuid, text)
  owner to renoly_rls_owner;
revoke all on function public.convert_service_request(uuid, uuid, integer, text, text, jsonb, uuid, text)
  from public;
grant execute on function public.convert_service_request(uuid, uuid, integer, text, text, jsonb, uuid, text)
  to authenticated;

------------------------------------------------------------------------------
-- 7. find_similar_customers RPC (hint-only, no merge)
------------------------------------------------------------------------------

create or replace function public.find_similar_customers(
  target_org uuid,
  p_phone text default null,
  p_name text default null,
  p_limit integer default 5
)
returns table (
  customer_id uuid,
  customer_no text,
  name text,
  phone text,
  match_reason text
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_limit integer := coalesce(p_limit, 5);
  v_phone text := nullif(btrim(p_phone), '');
  v_name text := nullif(btrim(p_name), '');
  v_phone_suffix text;
begin
  if not public.has_org_role(target_org, array['owner', 'admin', 'dispatcher']::text[]) then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;
  if v_limit < 1 or v_limit > 25 then
    raise exception using errcode = '22023', message = 'INVALID_LIMIT';
  end if;
  if (v_phone is not null and char_length(v_phone) > 40)
     or (v_name is not null and char_length(v_name) > 200) then
    raise exception using errcode = '22023', message = 'PILOT_VALIDATION_FAILED';
  end if;
  if v_phone is null and v_name is null then
    return;
  end if;

  -- Match on the last 8 phone digits (local-number heuristic) or name ilike.
  v_phone_suffix := right(regexp_replace(coalesce(v_phone, ''), '[^0-9]', '', 'g'), 8);

  return query
  select
    c.id,
    c.customer_no,
    c.name,
    c.phone,
    case
      when v_phone is not null
        and length(v_phone_suffix) >= 6
        and right(regexp_replace(coalesce(c.phone, ''), '[^0-9]', '', 'g'), 8) = v_phone_suffix
        then 'phone'
      else 'name'
    end as match_reason
  from public.customers c
  where c.organization_id = target_org
    and c.deleted_at is null
    and (
      (
        v_phone is not null
        and length(v_phone_suffix) >= 6
        and c.phone is not null
        and right(regexp_replace(c.phone, '[^0-9]', '', 'g'), 8) = v_phone_suffix
      )
      or (
        v_name is not null
        and position(lower(v_name) in lower(c.name)) > 0
      )
    )
  order by
    (
      case
        when v_phone is not null
          and length(v_phone_suffix) >= 6
          and right(regexp_replace(coalesce(c.phone, ''), '[^0-9]', '', 'g'), 8) = v_phone_suffix
          then 0
        else 1
      end
    ),
    c.last_contact_at desc nulls last,
    c.id desc
  limit v_limit;
end;
$$;

alter function public.find_similar_customers(uuid, text, text, integer)
  owner to renoly_rls_owner;
revoke all on function public.find_similar_customers(uuid, text, text, integer)
  from public;
grant execute on function public.find_similar_customers(uuid, text, text, integer)
  to authenticated;

------------------------------------------------------------------------------
-- 8. list_pilot_service_requests keyset overload (new signature)
------------------------------------------------------------------------------
-- New (uuid, text, timestamptz, uuid, integer) overload for deep keyset
-- pagination with an optional status filter. The original (uuid, integer)
-- overload is untouched so the existing pgTAP pin stays green.

create or replace function public.list_pilot_service_requests(
  p_organization_id uuid,
  p_status text default null,
  p_after_created_at timestamptz default null,
  p_after_id uuid default null,
  p_limit integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_items jsonb;
begin
  if not public.has_org_role(
    p_organization_id, array['owner', 'admin', 'dispatcher']::text[]
  ) then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception using errcode = '22023', message = 'PILOT_VALIDATION_FAILED';
  end if;
  if p_status is not null and p_status not in (
    'new', 'triaged', 'quoting', 'quoted', 'converted', 'declined', 'cancelled'
  ) then
    raise exception using errcode = '22023', message = 'PILOT_VALIDATION_FAILED';
  end if;
  if (p_after_created_at is null) <> (p_after_id is null) then
    raise exception using errcode = '22023', message = 'PILOT_VALIDATION_FAILED';
  end if;

  select coalesce(jsonb_agg(row_value order by created_at desc, id desc), '[]'::jsonb)
  into v_items
  from (
    select
      sr.id,
      sr.created_at,
      jsonb_build_object(
        'id', sr.id,
        'requestNo', sr.request_no,
        'contactName', sr.contact_name,
        'contactPhone', sr.contact_phone,
        'subject', sr.subject,
        'description', sr.description,
        'status', sr.status,
        'priority', sr.priority,
        'category', sr.category,
        'lockVersion', sr.lock_version,
        'customerId', sr.customer_id,
        'assignedMemberId', sr.assigned_member_id,
        'triagedAt', sr.triaged_at,
        'serviceCatalogItemId', sci.id,
        'serviceName', sci.name,
        'serviceCategory', sci.category,
        'address', concat_ws('', l.postal_code, l.county, l.district, l.address_line),
        'photoCount', (
          select count(*)::integer from public.photos p
          where p.organization_id = sr.organization_id
            and p.service_request_id = sr.id
            and p.status = 'ready' and p.deleted_at is null
        ),
        'preferredWindows', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'startsAt', tw.starts_at,
              'endsAt', tw.ends_at,
              'preferenceRank', tw.preference_rank
            ) order by tw.preference_rank
          )
          from public.service_request_time_windows tw
          where tw.organization_id = sr.organization_id
            and tw.service_request_id = sr.id
        ), '[]'::jsonb),
        'createdAt', sr.created_at,
        'updatedAt', sr.updated_at
      ) as row_value
    from public.service_requests sr
    left join public.locations l
      on l.organization_id = sr.organization_id and l.id = sr.location_id
    left join public.service_catalog_items sci
      on sci.organization_id = sr.organization_id
     and sci.id::text = sr.metadata ->> 'serviceCatalogItemId'
    where sr.organization_id = p_organization_id
      and (p_status is null or sr.status = p_status)
      and (
        p_after_created_at is null
        or (sr.created_at, sr.id) < (p_after_created_at, p_after_id)
      )
    order by sr.created_at desc, sr.id desc
    limit p_limit
  ) inbox_rows;

  return jsonb_build_object('organizationId', p_organization_id, 'items', v_items);
end;
$$;

alter function public.list_pilot_service_requests(uuid, text, timestamptz, uuid, integer)
  owner to renoly_rls_owner;
revoke all on function public.list_pilot_service_requests(uuid, text, timestamptz, uuid, integer)
  from public, anon, service_role;
grant execute on function public.list_pilot_service_requests(uuid, text, timestamptz, uuid, integer)
  to authenticated;
