-- M4 real quote vertical slice.
--
-- Staff traffic remains authenticated-RPC-only. Public traffic is resolved by
-- service-role-only capability RPCs; raw tokens never enter Postgres. Every
-- state-changing quote operation locks the aggregate, validates an optimistic
-- version, and appends events inside the same transaction.

create unique index if not exists quotes_one_per_service_request_uidx
  on public.quotes (organization_id, service_request_id)
  where service_request_id is not null;

-------------------------------------------------------------------------------
-- Private validation and DTO builders
-------------------------------------------------------------------------------

create or replace function private.validate_pilot_quote_version_payload(p_payload jsonb)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_item jsonb;
  v_valid_until text;
begin
  if p_payload is null
     or jsonb_typeof(p_payload) <> 'object'
     or not (p_payload ?& array[
       'title', 'validUntil', 'customerNotes', 'internalNotes', 'terms', 'items'
     ])
     or exists (
       select 1 from jsonb_object_keys(p_payload) key
       where key <> all(array[
         'title', 'validUntil', 'customerNotes', 'internalNotes', 'terms', 'items'
       ])
     )
     or nullif(btrim(p_payload ->> 'title'), '') is null
     or char_length(btrim(p_payload ->> 'title')) > 160
     or jsonb_typeof(p_payload -> 'customerNotes') <> 'string'
     or char_length(p_payload ->> 'customerNotes') > 10000
     or jsonb_typeof(p_payload -> 'internalNotes') <> 'string'
     or char_length(p_payload ->> 'internalNotes') > 10000
     or jsonb_typeof(p_payload -> 'terms') <> 'string'
     or char_length(p_payload ->> 'terms') > 10000
     or jsonb_typeof(p_payload -> 'items') <> 'array'
     or jsonb_array_length(p_payload -> 'items') not between 1 and 300
     or octet_length(p_payload::text) > 262144 then
    raise exception using errcode = '22023', message = 'PILOT_VALIDATION_FAILED';
  end if;

  v_valid_until := p_payload ->> 'validUntil';
  if v_valid_until is not null then
    if v_valid_until !~ '^\d{4}-\d{2}-\d{2}$'
       or to_char(v_valid_until::date, 'YYYY-MM-DD') <> v_valid_until then
      raise exception using errcode = '22023', message = 'PILOT_VALIDATION_FAILED';
    end if;
  end if;

  for v_item in select value from jsonb_array_elements(p_payload -> 'items') loop
    if jsonb_typeof(v_item) <> 'object'
       or not (v_item ?& array[
         'serviceCatalogItemId', 'groupName', 'name', 'specification', 'unit',
         'quantity', 'unitCostMinor', 'unitPriceMinor', 'discountMinor',
         'taxRate', 'sortOrder'
       ])
       or exists (
         select 1 from jsonb_object_keys(v_item) key
         where key <> all(array[
           'serviceCatalogItemId', 'groupName', 'name', 'specification', 'unit',
           'quantity', 'unitCostMinor', 'unitPriceMinor', 'discountMinor',
           'taxRate', 'sortOrder'
         ])
       )
       or jsonb_typeof(v_item -> 'groupName') <> 'string'
       or char_length(v_item ->> 'groupName') > 120
       or nullif(btrim(v_item ->> 'name'), '') is null
       or char_length(btrim(v_item ->> 'name')) > 300
       or jsonb_typeof(v_item -> 'specification') <> 'string'
       or char_length(v_item ->> 'specification') > 5000
       or nullif(btrim(v_item ->> 'unit'), '') is null
       or char_length(btrim(v_item ->> 'unit')) > 20
       or (v_item ->> 'quantity') !~ '^(0|[1-9][0-9]*)(\.[0-9]{1,3})?$'
       or (v_item ->> 'quantity')::numeric <= 0
       or (v_item ->> 'quantity')::numeric > 999999999.999
       or (v_item ->> 'unitCostMinor') !~ '^[0-9]{1,19}$'
       or (v_item ->> 'unitCostMinor')::numeric > 9223372036854775807
       or (v_item ->> 'unitPriceMinor') !~ '^[0-9]{1,19}$'
       or (v_item ->> 'unitPriceMinor')::numeric > 9223372036854775807
       or (v_item ->> 'discountMinor') !~ '^[0-9]{1,19}$'
       or (v_item ->> 'discountMinor')::numeric > 9223372036854775807
       or (v_item ->> 'taxRate') !~ '^(0(\.[0-9]{1,4})?|1(\.0{1,4})?)$'
       or (v_item ->> 'sortOrder') !~ '^[0-9]{1,6}$'
       or (v_item ->> 'sortOrder')::integer > 100000
       or (
         jsonb_typeof(v_item -> 'serviceCatalogItemId') <> 'null'
         and (
           jsonb_typeof(v_item -> 'serviceCatalogItemId') <> 'string'
           or (v_item ->> 'serviceCatalogItemId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
         )
       ) then
      raise exception using errcode = '22023', message = 'PILOT_VALIDATION_FAILED';
    end if;
  end loop;

  if (
    select count(*) <> count(distinct (value ->> 'sortOrder')::integer)
    from jsonb_array_elements(p_payload -> 'items')
  ) then
    raise exception using errcode = '22023', message = 'PILOT_VALIDATION_FAILED';
  end if;
exception
  when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow then
    raise exception using errcode = '22023', message = 'PILOT_VALIDATION_FAILED';
end;
$$;

alter function private.validate_pilot_quote_version_payload(jsonb) owner to renoly_rls_owner;
revoke all on function private.validate_pilot_quote_version_payload(jsonb)
  from public, anon, authenticated, service_role;

create or replace function private.pilot_quote_workspace_json(
  p_organization_id uuid,
  p_quote_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, private
as $$
  select jsonb_build_object(
    'quote', jsonb_build_object(
      'id', q.id,
      'quoteNo', q.quote_no,
      'serviceRequestId', q.service_request_id,
      'customerId', q.customer_id,
      'locationId', q.location_id,
      'status', q.status,
      'currency', q.currency,
      'latestVersionId', q.latest_version_id,
      'activeVersionId', q.active_version_id,
      'acceptedVersionId', q.accepted_version_id,
      'sentAt', q.sent_at,
      'firstViewedAt', q.first_viewed_at,
      'acceptedAt', q.accepted_at,
      'rejectedAt', q.rejected_at,
      'rejectionReason', q.rejection_reason,
      'expiresAt', q.expires_at,
      'lockVersion', q.lock_version,
      'createdAt', q.created_at,
      'updatedAt', q.updated_at
    ),
    'version', jsonb_build_object(
      'id', qv.id,
      'quoteId', qv.quote_id,
      'versionNo', qv.version_no,
      'status', qv.status,
      'approvalStatus', qv.approval_status,
      'title', qv.title,
      'validUntil', qv.valid_until,
      'customerNotes', qv.customer_notes,
      'internalNotes', qv.internal_notes,
      'terms', qv.terms,
      'subtotalMinor', qv.subtotal_minor::text,
      'discountMinor', qv.discount_minor::text,
      'taxMinor', qv.tax_minor::text,
      'totalMinor', qv.total_minor::text,
      'items', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', qi.id,
            'serviceCatalogItemId', qi.service_catalog_item_id,
            'groupName', qi.group_name,
            'name', qi.name,
            'specification', qi.specification,
            'unit', qi.unit,
            'quantity', qi.quantity::text,
            'unitCostMinor', qi.unit_cost_minor::text,
            'unitPriceMinor', qi.unit_price_minor::text,
            'discountMinor', qi.discount_minor::text,
            'taxRate', qi.tax_rate::text,
            'subtotalMinor', qi.subtotal_minor::text,
            'taxMinor', qi.tax_minor::text,
            'totalMinor', qi.total_minor::text,
            'sortOrder', qi.sort_order
          ) order by qi.sort_order, qi.id
        )
        from public.quote_items qi
        where qi.organization_id = q.organization_id
          and qi.quote_version_id = qv.id
      ), '[]'::jsonb),
      'createdAt', qv.created_at,
      'updatedAt', qv.updated_at
    ),
    'request', jsonb_build_object(
      'id', sr.id,
      'requestNo', sr.request_no,
      'subject', sr.subject,
      'status', sr.status,
      'lockVersion', sr.lock_version
    ),
    'customer', jsonb_build_object(
      'id', c.id,
      'name', c.name,
      'phone', c.phone
    ),
    'location', jsonb_build_object(
      'id', l.id,
      'label', l.label,
      'address', concat_ws('', l.postal_code, l.county, l.district, l.address_line)
    )
  )
  from public.quotes q
  join public.quote_versions qv
    on qv.organization_id = q.organization_id and qv.id = q.latest_version_id
  join public.service_requests sr
    on sr.organization_id = q.organization_id and sr.id = q.service_request_id
  join public.customers c
    on c.organization_id = q.organization_id and c.id = q.customer_id
  join public.locations l
    on l.organization_id = q.organization_id and l.id = q.location_id
  where q.organization_id = p_organization_id and q.id = p_quote_id;
$$;

alter function private.pilot_quote_workspace_json(uuid, uuid) owner to renoly_rls_owner;
revoke all on function private.pilot_quote_workspace_json(uuid, uuid)
  from public, anon, authenticated, service_role;

create or replace function private.append_customer_event(
  p_organization_id uuid,
  p_customer_id uuid,
  p_aggregate_type text,
  p_aggregate_id uuid,
  p_event_type text,
  p_payload jsonb,
  p_request_id uuid default null,
  p_idempotency_key text default null,
  p_occurred_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, private, extensions
as $$
declare
  v_event_id uuid := gen_random_uuid();
  v_previous_hash bytea;
  v_event_hash bytea;
  v_occurred timestamptz := coalesce(p_occurred_at, statement_timestamp());
  v_recorded timestamptz := clock_timestamp();
  v_sequence bigint;
begin
  if not exists (
    select 1 from public.customers c
    where c.organization_id = p_organization_id and c.id = p_customer_id
  ) then
    raise exception using errcode = '23503', message = 'CUSTOMER_NOT_FOUND';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      p_organization_id::text || ':' || p_aggregate_type || ':' || p_aggregate_id::text,
      0
    )
  );

  select e.event_hash, e.chain_sequence + 1
  into v_previous_hash, v_sequence
  from public.events e
  where e.organization_id = p_organization_id
    and e.aggregate_type = p_aggregate_type
    and e.aggregate_id = p_aggregate_id
  order by e.chain_sequence desc
  limit 1
  for share;

  v_sequence := coalesce(v_sequence, 1);
  v_event_hash := extensions.digest(
    coalesce(encode(v_previous_hash, 'hex'), '') || '|' || p_organization_id::text || '|'
    || p_aggregate_type || '|' || p_aggregate_id::text || '|'
    || p_event_type || '|customer:' || p_customer_id::text || '|' || v_occurred::text || '|'
    || v_recorded::text || '|' || v_sequence::text || '|'
    || coalesce(p_payload, '{}'::jsonb)::text,
    'sha256'
  );

  insert into public.events (
    id, organization_id, aggregate_type, aggregate_id, event_type,
    actor_type, actor_customer_id, occurred_at, recorded_at, chain_sequence,
    request_id, idempotency_key, payload, prev_hash, event_hash
  ) values (
    v_event_id, p_organization_id, p_aggregate_type, p_aggregate_id, p_event_type,
    'customer', p_customer_id, v_occurred, v_recorded, v_sequence,
    coalesce(p_request_id, gen_random_uuid()), p_idempotency_key,
    coalesce(p_payload, '{}'::jsonb), v_previous_hash, v_event_hash
  );

  return v_event_id;
end;
$$;

alter function private.append_customer_event(uuid, uuid, text, uuid, text, jsonb, uuid, text, timestamptz)
  owner to renoly_rls_owner;
revoke all on function private.append_customer_event(uuid, uuid, text, uuid, text, jsonb, uuid, text, timestamptz)
  from public, anon, authenticated, service_role;

create or replace function private.pilot_public_quote_json(
  p_organization_id uuid,
  p_version_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, private
as $$
  select jsonb_build_object(
    'merchant', jsonb_build_object('name', o.name, 'phone', o.phone),
    'quoteNo', q.quote_no,
    'versionNo', qv.version_no,
    'status', q.status,
    'validUntil', qv.valid_until,
    'title', qv.title,
    'items', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'name', qi.name,
          'specification', qi.specification,
          'unit', qi.unit,
          'quantity', qi.quantity::text,
          'unitPriceMinor', qi.unit_price_minor::text,
          'discountMinor', qi.discount_minor::text,
          'totalMinor', qi.total_minor::text
        ) order by qi.sort_order, qi.id
      )
      from public.quote_items qi
      where qi.organization_id = q.organization_id
        and qi.quote_version_id = qv.id
    ), '[]'::jsonb),
    'subtotalMinor', qv.subtotal_minor::text,
    'discountMinor', qv.discount_minor::text,
    'taxMinor', qv.tax_minor::text,
    'totalMinor', qv.total_minor::text,
    'currency', q.currency,
    'customerNotes', qv.customer_notes,
    'terms', qv.terms,
    'decision', (
      select case
        when e.id is null then null
        else jsonb_build_object(
          'decision', e.payload ->> 'decision',
          'recordedAt', e.occurred_at,
          'displayName', e.payload ->> 'displayName',
          'comment', e.payload -> 'comment'
        )
      end
      from (select 1) singleton
      left join lateral (
        select event_row.*
        from public.events event_row
        where event_row.organization_id = q.organization_id
          and event_row.aggregate_type = 'quote'
          and event_row.aggregate_id = q.id
          and event_row.event_type in ('quote.accepted', 'quote.rejected')
        order by event_row.chain_sequence desc
        limit 1
      ) e on true
    )
  )
  from public.quote_versions qv
  join public.quotes q
    on q.organization_id = qv.organization_id and q.id = qv.quote_id
  join public.organizations o on o.id = q.organization_id
  where qv.organization_id = p_organization_id and qv.id = p_version_id;
$$;

alter function private.pilot_public_quote_json(uuid, uuid) owner to renoly_rls_owner;
revoke all on function private.pilot_public_quote_json(uuid, uuid)
  from public, anon, authenticated, service_role;

-------------------------------------------------------------------------------
-- Staff quote create/read/save
-------------------------------------------------------------------------------

create or replace function public.create_pilot_quote(
  p_organization_id uuid,
  p_service_request_id uuid,
  p_expected_request_lock_version integer,
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
  v_request public.service_requests%rowtype;
  v_quote_id uuid := gen_random_uuid();
  v_version_id uuid := gen_random_uuid();
  v_item jsonb;
  v_period text;
  v_sequence bigint;
  v_quote_no text;
  v_totals record;
  v_actor_fingerprint text;
  v_request_hash text;
  v_idempotency public.idempotency_keys%rowtype;
  v_inserted integer;
  v_workspace jsonb;
begin
  if not public.has_org_role(
    p_organization_id, array['owner', 'admin', 'dispatcher']::text[]
  ) then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;
  if nullif(btrim(p_idempotency_key), '') is null
     or char_length(p_idempotency_key) not between 8 and 128
     or p_payload is null
     or jsonb_typeof(p_payload) <> 'object'
     or not (p_payload ?& array['customerId', 'locationId', 'currency'])
     or exists (
       select 1 from jsonb_object_keys(p_payload) key
       where key <> all(array[
         'customerId', 'locationId', 'currency', 'title', 'validUntil',
         'customerNotes', 'internalNotes', 'terms', 'items'
       ])
     ) then
    raise exception using errcode = '22023', message = 'PILOT_VALIDATION_FAILED';
  end if;

  perform private.validate_pilot_quote_version_payload(
    p_payload - array['customerId', 'locationId', 'currency']
  );

  v_actor_fingerprint := 'pilot-quote-create:' || v_actor::text;
  v_request_hash := encode(extensions.digest(
    p_organization_id::text || '|' || p_service_request_id::text || '|' || p_payload::text,
    'sha256'
  ), 'hex');

  insert into public.idempotency_keys (
    organization_id, actor_fingerprint, method, path_template,
    idempotency_key, request_hash, state, locked_until, expires_at
  ) values (
    p_organization_id, v_actor_fingerprint, 'POST',
    '/api/v2/organizations/{orgId}/quotes', p_idempotency_key,
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
      and path_template = '/api/v2/organizations/{orgId}/quotes'
      and idempotency_key = p_idempotency_key
    for update;

    if v_idempotency.request_hash is distinct from v_request_hash then
      raise exception using errcode = '22023', message = 'PILOT_IDEMPOTENCY_CONFLICT';
    end if;
    if v_idempotency.state = 'completed' and v_idempotency.resource_id is not null then
      return private.pilot_quote_workspace_json(
        p_organization_id, v_idempotency.resource_id
      ) || jsonb_build_object('replayed', true);
    end if;
    raise exception using errcode = '22023', message = 'PILOT_IDEMPOTENCY_IN_PROGRESS';
  end if;

  select * into v_request
  from public.service_requests sr
  where sr.organization_id = p_organization_id and sr.id = p_service_request_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'SERVICE_REQUEST_NOT_FOUND';
  end if;
  if v_request.lock_version is distinct from p_expected_request_lock_version then
    raise exception using errcode = '40001', message = 'STALE_VERSION';
  end if;
  if v_request.status not in ('triaged', 'quoting') then
    raise exception using errcode = '23514', message = 'QUOTE_REQUEST_NOT_READY';
  end if;
  if v_request.customer_id is null or v_request.location_id is null
     or (p_payload ->> 'customerId')::uuid is distinct from v_request.customer_id
     or (p_payload ->> 'locationId')::uuid is distinct from v_request.location_id then
    raise exception using errcode = '23503', message = 'QUOTE_BINDING_MISMATCH';
  end if;
  if p_payload ->> 'currency' <> 'TWD' then
    raise exception using errcode = '22023', message = 'PILOT_VALIDATION_FAILED';
  end if;
  if exists (
    select 1 from public.quotes q
    where q.organization_id = p_organization_id
      and q.service_request_id = p_service_request_id
  ) then
    raise exception using errcode = '23505', message = 'QUOTE_ALREADY_EXISTS';
  end if;

  select to_char(statement_timestamp() at time zone o.timezone, 'YYYYMM')
  into v_period
  from public.organizations o where o.id = p_organization_id;

  insert into public.document_sequences (
    organization_id, document_type, period_key, current_value
  ) values (p_organization_id, 'quote', v_period, 1)
  on conflict (organization_id, document_type, period_key)
  do update set current_value = public.document_sequences.current_value + 1,
                updated_at = statement_timestamp()
  returning current_value into v_sequence;
  v_quote_no := 'Q-' || v_period || '-' || lpad(v_sequence::text, 6, '0');

  insert into public.quotes (
    id, organization_id, quote_no, service_request_id, customer_id, location_id,
    status, latest_version_id, currency, created_by, updated_by
  ) values (
    v_quote_id, p_organization_id, v_quote_no, p_service_request_id,
    v_request.customer_id, v_request.location_id, 'draft', v_version_id, 'TWD',
    v_actor, v_actor
  );

  insert into public.quote_versions (
    id, organization_id, quote_id, version_no, status, approval_status,
    title, customer_notes, internal_notes, terms, valid_until,
    created_by, updated_by
  ) values (
    v_version_id, p_organization_id, v_quote_id, 1, 'draft', 'not_submitted',
    btrim(p_payload ->> 'title'), p_payload ->> 'customerNotes',
    p_payload ->> 'internalNotes', p_payload ->> 'terms',
    (p_payload ->> 'validUntil')::date, v_actor, v_actor
  );

  for v_item in select value from jsonb_array_elements(p_payload -> 'items') loop
    insert into public.quote_items (
      organization_id, quote_version_id, service_catalog_item_id,
      group_name, name, specification, unit, quantity,
      unit_cost_minor, unit_price_minor, discount_minor, tax_rate,
      subtotal_minor, tax_minor, total_minor, sort_order
    ) values (
      p_organization_id, v_version_id,
      nullif(v_item ->> 'serviceCatalogItemId', '')::uuid,
      v_item ->> 'groupName', btrim(v_item ->> 'name'),
      v_item ->> 'specification', btrim(v_item ->> 'unit'),
      (v_item ->> 'quantity')::numeric,
      (v_item ->> 'unitCostMinor')::bigint,
      (v_item ->> 'unitPriceMinor')::bigint,
      (v_item ->> 'discountMinor')::bigint,
      (v_item ->> 'taxRate')::numeric,
      0, 0, 0, (v_item ->> 'sortOrder')::integer
    );
  end loop;

  select sum(qi.subtotal_minor)::bigint as subtotal,
         sum(qi.discount_minor)::bigint as discount,
         sum(qi.tax_minor)::bigint as tax,
         sum(qi.total_minor)::bigint as total
  into v_totals
  from public.quote_items qi
  where qi.organization_id = p_organization_id
    and qi.quote_version_id = v_version_id;

  update public.quote_versions
  set subtotal_minor = v_totals.subtotal,
      discount_minor = v_totals.discount,
      tax_minor = v_totals.tax,
      total_minor = v_totals.total,
      updated_by = v_actor
  where organization_id = p_organization_id and id = v_version_id;

  update public.service_requests
  set status = 'quoting', updated_by = v_actor,
      lock_version = lock_version + 1
  where organization_id = p_organization_id and id = p_service_request_id;

  perform private.append_user_event(
    p_organization_id, 'quote', v_quote_id, 'quote.created',
    jsonb_build_object(
      'serviceRequestId', p_service_request_id,
      'quoteVersionId', v_version_id,
      'versionNo', 1,
      'totalMinor', v_totals.total
    ), p_request_id, p_idempotency_key
  );
  perform private.append_user_event(
    p_organization_id, 'service_request', p_service_request_id,
    'service_request.quoting',
    jsonb_build_object('from', v_request.status, 'to', 'quoting', 'quoteId', v_quote_id),
    p_request_id, p_idempotency_key
  );

  v_workspace := private.pilot_quote_workspace_json(p_organization_id, v_quote_id);
  update public.idempotency_keys
  set state = 'completed', response_status = 201, response_body = v_workspace,
      resource_type = 'quote', resource_id = v_quote_id,
      locked_until = null, updated_at = clock_timestamp()
  where id = v_idempotency.id;

  return v_workspace;
exception
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception using errcode = '22023', message = 'PILOT_VALIDATION_FAILED';
end;
$$;

alter function public.create_pilot_quote(uuid, uuid, integer, jsonb, text, uuid)
  owner to renoly_rls_owner;
revoke all on function public.create_pilot_quote(uuid, uuid, integer, jsonb, text, uuid)
  from public, anon, service_role;
grant execute on function public.create_pilot_quote(uuid, uuid, integer, jsonb, text, uuid)
  to authenticated;

create or replace function public.get_pilot_quote_workspace(
  p_organization_id uuid,
  p_quote_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_result jsonb;
begin
  if not public.has_org_role(
    p_organization_id, array['owner', 'admin', 'dispatcher']::text[]
  ) then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;

  v_result := private.pilot_quote_workspace_json(p_organization_id, p_quote_id);
  if v_result is null then
    raise exception using errcode = 'P0002', message = 'QUOTE_NOT_FOUND';
  end if;
  return v_result;
end;
$$;

alter function public.get_pilot_quote_workspace(uuid, uuid) owner to renoly_rls_owner;
revoke all on function public.get_pilot_quote_workspace(uuid, uuid)
  from public, anon, service_role;
grant execute on function public.get_pilot_quote_workspace(uuid, uuid) to authenticated;

create or replace function public.get_pilot_quote_workspace_by_request(
  p_organization_id uuid,
  p_service_request_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_quote_id uuid;
begin
  if not public.has_org_role(
    p_organization_id, array['owner', 'admin', 'dispatcher']::text[]
  ) then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;
  if not exists (
    select 1 from public.service_requests sr
    where sr.organization_id = p_organization_id and sr.id = p_service_request_id
  ) then
    raise exception using errcode = 'P0002', message = 'QUOTE_NOT_FOUND';
  end if;
  select q.id into v_quote_id
  from public.quotes q
  where q.organization_id = p_organization_id
    and q.service_request_id = p_service_request_id;
  if v_quote_id is null then
    raise exception using errcode = 'P0002', message = 'QUOTE_NOT_FOUND';
  end if;
  return private.pilot_quote_workspace_json(p_organization_id, v_quote_id);
end;
$$;

alter function public.get_pilot_quote_workspace_by_request(uuid, uuid)
  owner to renoly_rls_owner;
revoke all on function public.get_pilot_quote_workspace_by_request(uuid, uuid)
  from public, anon, service_role;
grant execute on function public.get_pilot_quote_workspace_by_request(uuid, uuid)
  to authenticated;

create or replace function public.save_pilot_quote_draft(
  p_organization_id uuid,
  p_quote_id uuid,
  p_version_id uuid,
  p_expected_quote_lock_version integer,
  p_payload jsonb,
  p_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_actor uuid := (select private.current_actor_user_id());
  v_quote public.quotes%rowtype;
  v_version public.quote_versions%rowtype;
  v_item jsonb;
  v_totals record;
begin
  if not public.has_org_role(
    p_organization_id, array['owner', 'admin', 'dispatcher']::text[]
  ) then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;
  perform private.validate_pilot_quote_version_payload(p_payload);

  select * into v_quote
  from public.quotes q
  where q.organization_id = p_organization_id and q.id = p_quote_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'QUOTE_NOT_FOUND';
  end if;
  if v_quote.lock_version is distinct from p_expected_quote_lock_version then
    raise exception using errcode = '40001', message = 'STALE_VERSION';
  end if;
  if v_quote.latest_version_id is distinct from p_version_id then
    raise exception using errcode = '23514', message = 'ACTIVE_VERSION_CHANGED';
  end if;

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

  delete from public.quote_items
  where organization_id = p_organization_id and quote_version_id = p_version_id;

  for v_item in select value from jsonb_array_elements(p_payload -> 'items') loop
    insert into public.quote_items (
      organization_id, quote_version_id, service_catalog_item_id,
      group_name, name, specification, unit, quantity,
      unit_cost_minor, unit_price_minor, discount_minor, tax_rate,
      subtotal_minor, tax_minor, total_minor, sort_order
    ) values (
      p_organization_id, p_version_id,
      nullif(v_item ->> 'serviceCatalogItemId', '')::uuid,
      v_item ->> 'groupName', btrim(v_item ->> 'name'),
      v_item ->> 'specification', btrim(v_item ->> 'unit'),
      (v_item ->> 'quantity')::numeric,
      (v_item ->> 'unitCostMinor')::bigint,
      (v_item ->> 'unitPriceMinor')::bigint,
      (v_item ->> 'discountMinor')::bigint,
      (v_item ->> 'taxRate')::numeric,
      0, 0, 0, (v_item ->> 'sortOrder')::integer
    );
  end loop;

  select sum(qi.subtotal_minor)::bigint as subtotal,
         sum(qi.discount_minor)::bigint as discount,
         sum(qi.tax_minor)::bigint as tax,
         sum(qi.total_minor)::bigint as total
  into v_totals
  from public.quote_items qi
  where qi.organization_id = p_organization_id
    and qi.quote_version_id = p_version_id;

  update public.quote_versions
  set title = btrim(p_payload ->> 'title'),
      valid_until = (p_payload ->> 'validUntil')::date,
      customer_notes = p_payload ->> 'customerNotes',
      internal_notes = p_payload ->> 'internalNotes',
      terms = p_payload ->> 'terms',
      subtotal_minor = v_totals.subtotal,
      discount_minor = v_totals.discount,
      tax_minor = v_totals.tax,
      total_minor = v_totals.total,
      approval_status = 'not_submitted',
      submitted_for_approval_at = null,
      submitted_for_approval_by = null,
      approved_at = null,
      approved_by = null,
      approval_rejection_reason = null,
      updated_by = v_actor,
      lock_version = lock_version + 1
  where organization_id = p_organization_id and id = p_version_id;

  update public.quotes
  set updated_by = v_actor, lock_version = lock_version + 1
  where organization_id = p_organization_id and id = p_quote_id;

  perform private.append_user_event(
    p_organization_id, 'quote', p_quote_id, 'quote.draft_saved',
    jsonb_build_object(
      'quoteVersionId', p_version_id,
      'versionNo', v_version.version_no,
      'totalMinor', v_totals.total
    ), p_request_id, null
  );

  return private.pilot_quote_workspace_json(p_organization_id, p_quote_id);
exception
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception using errcode = '22023', message = 'PILOT_VALIDATION_FAILED';
end;
$$;

alter function public.save_pilot_quote_draft(uuid, uuid, uuid, integer, jsonb, uuid)
  owner to renoly_rls_owner;
revoke all on function public.save_pilot_quote_draft(uuid, uuid, uuid, integer, jsonb, uuid)
  from public, anon, service_role;
grant execute on function public.save_pilot_quote_draft(uuid, uuid, uuid, integer, jsonb, uuid)
  to authenticated;

-- Canonical HTTP route identifies a quote-version resource directly. This
-- overload derives its parent inside the trusted RPC so the browser never has
-- to supply a second, potentially inconsistent aggregate id.
create or replace function public.save_pilot_quote_draft(
  p_organization_id uuid,
  p_version_id uuid,
  p_expected_quote_lock_version integer,
  p_payload jsonb,
  p_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_quote_id uuid;
begin
  select qv.quote_id into v_quote_id
  from public.quote_versions qv
  where qv.organization_id = p_organization_id and qv.id = p_version_id;
  if v_quote_id is null then
    raise exception using errcode = 'P0002', message = 'QUOTE_VERSION_NOT_FOUND';
  end if;
  return public.save_pilot_quote_draft(
    p_organization_id, v_quote_id, p_version_id,
    p_expected_quote_lock_version, p_payload, p_request_id
  );
end;
$$;

alter function public.save_pilot_quote_draft(uuid, uuid, integer, jsonb, uuid)
  owner to renoly_rls_owner;
revoke all on function public.save_pilot_quote_draft(uuid, uuid, integer, jsonb, uuid)
  from public, anon, service_role;
grant execute on function public.save_pilot_quote_draft(uuid, uuid, integer, jsonb, uuid)
  to authenticated;

-------------------------------------------------------------------------------
-- Owner approve-and-send and revision cloning
-------------------------------------------------------------------------------

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

  perform private.append_user_event(
    p_organization_id, 'quote', p_quote_id, 'quote.sent',
    jsonb_build_object(
      'quoteVersionId', p_version_id,
      'versionNo', v_version.version_no,
      'totalMinor', v_total,
      'validUntil', v_version.valid_until
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

create or replace function public.rotate_pilot_quote_public_token(
  p_organization_id uuid,
  p_quote_id uuid,
  p_expected_quote_lock_version integer,
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
  v_timezone text;
  v_token_hash bytea;
  v_expires_at timestamptz;
  v_actor_fingerprint text;
  v_request_hash text;
  v_idempotency public.idempotency_keys%rowtype;
  v_inserted integer;
  v_workspace jsonb;
begin
  if not public.has_org_role(p_organization_id, array['owner', 'admin']::text[]) then
    raise exception using errcode = '42501', message = 'QUOTE_SEND_ROLE_REQUIRED';
  end if;
  if nullif(btrim(p_idempotency_key), '') is null
     or char_length(p_idempotency_key) not between 8 and 128 then
    raise exception using errcode = '22023', message = 'PILOT_VALIDATION_FAILED';
  end if;
  v_token_hash := private.decode_pilot_sha256_hex(
    p_public_token_hash_hex, 'PILOT_VALIDATION_FAILED'
  );
  v_actor_fingerprint := 'pilot-quote-link:' || v_actor::text || ':' || p_quote_id::text;
  v_request_hash := encode(extensions.digest(
    p_organization_id::text || '|' || p_quote_id::text, 'sha256'
  ), 'hex');

  insert into public.idempotency_keys (
    organization_id, actor_fingerprint, method, path_template,
    idempotency_key, request_hash, state, resource_type, resource_id,
    locked_until, expires_at
  ) values (
    p_organization_id, v_actor_fingerprint, 'POST',
    '/api/v2/organizations/{orgId}/quotes/{id}/actions/rotate-public-link',
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
      and path_template = '/api/v2/organizations/{orgId}/quotes/{id}/actions/rotate-public-link'
      and idempotency_key = p_idempotency_key
    for update;
    if v_idempotency.request_hash is distinct from v_request_hash then
      raise exception using errcode = '22023', message = 'PILOT_IDEMPOTENCY_CONFLICT';
    end if;
    if v_idempotency.state = 'completed' then
      select q.* into v_quote from public.quotes q
      where q.organization_id = p_organization_id and q.id = p_quote_id;
      if not found or v_quote.active_version_id is null then
        raise exception using errcode = 'P0002', message = 'QUOTE_NOT_FOUND';
      end if;
      select * into v_version from public.quote_versions
      where organization_id = p_organization_id and id = v_quote.active_version_id;
      if not exists (
        select 1 from public.public_access_tokens pat
        where pat.organization_id = p_organization_id
          and pat.resource_type = 'quote'
          and pat.resource_id = v_version.id
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
  if not found or v_quote.active_version_id is null then
    raise exception using errcode = 'P0002', message = 'QUOTE_NOT_FOUND';
  end if;
  if v_quote.lock_version is distinct from p_expected_quote_lock_version then
    raise exception using errcode = '40001', message = 'STALE_VERSION';
  end if;
  if v_quote.status not in ('sent', 'viewed', 'accepted', 'rejected') then
    raise exception using errcode = '23514', message = 'QUOTE_NOT_RESPONDABLE';
  end if;
  select * into v_version
  from public.quote_versions
  where organization_id = p_organization_id and id = v_quote.active_version_id;
  select timezone into v_timezone from public.organizations where id = p_organization_id;
  v_expires_at := least(statement_timestamp() + interval '30 days', case
    when v_version.valid_until is null then statement_timestamp() + interval '30 days'
    else (v_version.valid_until::timestamp + interval '1 day') at time zone v_timezone
  end);

  update public.public_access_tokens pat
  set revoked_at = statement_timestamp()
  where pat.organization_id = p_organization_id
    and pat.resource_type = 'quote' and pat.revoked_at is null
    and exists (
      select 1 from public.quote_versions qv
      where qv.organization_id = pat.organization_id
        and qv.id = pat.resource_id and qv.quote_id = p_quote_id
    );
  insert into public.public_access_tokens (
    organization_id, resource_type, resource_id, token_hash, scopes,
    expires_at, max_uses, created_by
  ) values (
    p_organization_id, 'quote', v_version.id, v_token_hash,
    array['quote:read', 'quote:respond']::text[], v_expires_at, null, v_actor
  );
  update public.quotes
  set updated_by = v_actor, lock_version = lock_version + 1
  where organization_id = p_organization_id and id = p_quote_id;
  perform private.append_user_event(
    p_organization_id, 'quote', p_quote_id, 'quote.public_link_rotated',
    jsonb_build_object('quoteVersionId', v_version.id),
    p_request_id, p_idempotency_key
  );

  v_workspace := private.pilot_quote_workspace_json(p_organization_id, p_quote_id);
  update public.idempotency_keys
  set state = 'completed', response_status = 200, response_body = v_workspace,
      locked_until = null, updated_at = clock_timestamp()
  where id = v_idempotency.id;
  return v_workspace;
end;
$$;

alter function public.rotate_pilot_quote_public_token(uuid, uuid, integer, text, text, uuid)
  owner to renoly_rls_owner;
revoke all on function public.rotate_pilot_quote_public_token(uuid, uuid, integer, text, text, uuid)
  from public, anon, service_role;
grant execute on function public.rotate_pilot_quote_public_token(uuid, uuid, integer, text, text, uuid)
  to authenticated;

create or replace function public.clone_pilot_quote_version(
  p_organization_id uuid,
  p_quote_id uuid,
  p_clone_from_version_id uuid,
  p_expected_quote_lock_version integer,
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
  v_source public.quote_versions%rowtype;
  v_new_version_id uuid := gen_random_uuid();
  v_next_version integer;
  v_actor_fingerprint text;
  v_request_hash text;
  v_idempotency public.idempotency_keys%rowtype;
  v_inserted integer;
  v_workspace jsonb;
begin
  if not public.has_org_role(
    p_organization_id, array['owner', 'admin', 'dispatcher']::text[]
  ) then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;
  if nullif(btrim(p_idempotency_key), '') is null
     or char_length(p_idempotency_key) not between 8 and 128 then
    raise exception using errcode = '22023', message = 'PILOT_VALIDATION_FAILED';
  end if;

  v_actor_fingerprint := 'pilot-quote-clone:' || v_actor::text || ':' || p_quote_id::text;
  v_request_hash := encode(extensions.digest(
    p_organization_id::text || '|' || p_quote_id::text || '|' || p_clone_from_version_id::text,
    'sha256'
  ), 'hex');
  insert into public.idempotency_keys (
    organization_id, actor_fingerprint, method, path_template,
    idempotency_key, request_hash, state, locked_until, expires_at
  ) values (
    p_organization_id, v_actor_fingerprint, 'POST',
    '/api/v2/organizations/{orgId}/quotes/{id}/versions',
    p_idempotency_key, v_request_hash, 'processing',
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
      and path_template = '/api/v2/organizations/{orgId}/quotes/{id}/versions'
      and idempotency_key = p_idempotency_key
    for update;
    if v_idempotency.request_hash is distinct from v_request_hash then
      raise exception using errcode = '22023', message = 'PILOT_IDEMPOTENCY_CONFLICT';
    end if;
    if v_idempotency.state = 'completed' and v_idempotency.resource_id is not null then
      select quote_id into p_quote_id
      from public.quote_versions
      where organization_id = p_organization_id and id = v_idempotency.resource_id;
      return private.pilot_quote_workspace_json(p_organization_id, p_quote_id)
        || jsonb_build_object('replayed', true);
    end if;
    raise exception using errcode = '22023', message = 'PILOT_IDEMPOTENCY_IN_PROGRESS';
  end if;

  select * into v_quote
  from public.quotes q
  where q.organization_id = p_organization_id and q.id = p_quote_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'QUOTE_NOT_FOUND';
  end if;
  if v_quote.lock_version is distinct from p_expected_quote_lock_version then
    raise exception using errcode = '40001', message = 'STALE_VERSION';
  end if;
  if v_quote.status <> 'rejected'
     or v_quote.active_version_id is distinct from p_clone_from_version_id then
    raise exception using errcode = '23514', message = 'QUOTE_REVISION_NOT_ALLOWED';
  end if;

  select * into v_source
  from public.quote_versions qv
  where qv.organization_id = p_organization_id
    and qv.id = p_clone_from_version_id and qv.quote_id = p_quote_id
  for share;
  if not found or v_source.status <> 'rejected' then
    raise exception using errcode = '23514', message = 'QUOTE_REVISION_NOT_ALLOWED';
  end if;

  select coalesce(max(qv.version_no), 0) + 1 into v_next_version
  from public.quote_versions qv
  where qv.organization_id = p_organization_id and qv.quote_id = p_quote_id;

  insert into public.quote_versions (
    id, organization_id, quote_id, version_no, status, approval_status,
    title, customer_notes, internal_notes, terms,
    subtotal_minor, discount_minor, tax_minor, total_minor, valid_until,
    created_from_version_id, created_by, updated_by
  ) values (
    v_new_version_id, p_organization_id, p_quote_id, v_next_version,
    'draft', 'not_submitted', v_source.title, v_source.customer_notes,
    v_source.internal_notes, v_source.terms,
    v_source.subtotal_minor, v_source.discount_minor, v_source.tax_minor,
    v_source.total_minor, v_source.valid_until,
    v_source.id, v_actor, v_actor
  );

  insert into public.quote_items (
    organization_id, quote_version_id, service_catalog_item_id,
    group_name, name, specification, unit, quantity,
    unit_cost_minor, unit_price_minor, discount_minor, tax_rate,
    subtotal_minor, tax_minor, total_minor, sort_order
  )
  select qi.organization_id, v_new_version_id, qi.service_catalog_item_id,
    qi.group_name, qi.name, qi.specification, qi.unit, qi.quantity,
    qi.unit_cost_minor, qi.unit_price_minor, qi.discount_minor, qi.tax_rate,
    qi.subtotal_minor, qi.tax_minor, qi.total_minor, qi.sort_order
  from public.quote_items qi
  where qi.organization_id = p_organization_id
    and qi.quote_version_id = p_clone_from_version_id
  order by qi.sort_order, qi.id;

  update public.quotes
  set status = 'draft', latest_version_id = v_new_version_id,
      updated_by = v_actor, lock_version = lock_version + 1
  where organization_id = p_organization_id and id = p_quote_id;

  perform private.append_user_event(
    p_organization_id, 'quote', p_quote_id, 'quote.version_created',
    jsonb_build_object(
      'quoteVersionId', v_new_version_id,
      'versionNo', v_next_version,
      'createdFromVersionId', p_clone_from_version_id
    ), p_request_id, p_idempotency_key
  );

  v_workspace := private.pilot_quote_workspace_json(p_organization_id, p_quote_id);
  update public.idempotency_keys
  set state = 'completed', response_status = 201, response_body = v_workspace,
      resource_type = 'quote_version', resource_id = v_new_version_id,
      locked_until = null, updated_at = clock_timestamp()
  where id = v_idempotency.id;
  return v_workspace;
end;
$$;

alter function public.clone_pilot_quote_version(uuid, uuid, uuid, integer, text, uuid)
  owner to renoly_rls_owner;
revoke all on function public.clone_pilot_quote_version(uuid, uuid, uuid, integer, text, uuid)
  from public, anon, service_role;
grant execute on function public.clone_pilot_quote_version(uuid, uuid, uuid, integer, text, uuid)
  to authenticated;

-------------------------------------------------------------------------------
-- Public capability gateway: shared abuse budget, sanitized read and decision
-------------------------------------------------------------------------------

-- This table is deliberately independent from request transactions. The API
-- first consumes a budget through the service-role-only RPC below; that RPC
-- commits before the read/respond RPC runs, so a rejected request cannot roll
-- its own rate-limit increment back.
create table private.pilot_public_quote_rate_limits (
  bucket_hash bytea not null,
  action text not null,
  window_started_at timestamptz not null,
  request_count integer not null default 1,
  updated_at timestamptz not null default clock_timestamp(),
  primary key (bucket_hash, action, window_started_at),
  constraint pilot_public_quote_rate_bucket_chk check (octet_length(bucket_hash) = 32),
  constraint pilot_public_quote_rate_action_chk check (
    action in ('quote_view_ip', 'quote_view_token', 'quote_respond_ip', 'quote_respond_token')
  ),
  constraint pilot_public_quote_rate_count_chk check (request_count between 1 and 100000)
);

create index pilot_public_quote_rate_window_idx
  on private.pilot_public_quote_rate_limits (window_started_at);

alter table private.pilot_public_quote_rate_limits owner to renoly_rls_owner;
alter table private.pilot_public_quote_rate_limits enable row level security;
alter table private.pilot_public_quote_rate_limits force row level security;
revoke all on private.pilot_public_quote_rate_limits
  from public, anon, authenticated, service_role;

create or replace function public.consume_pilot_public_quote_rate_limit(
  p_public_token_hash_hex text,
  p_client_ip_hash_hex text,
  p_action text
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public, private, extensions
as $$
declare
  v_token_hash bytea;
  v_ip_hash bytea;
  v_token public.public_access_tokens%rowtype;
  v_now timestamptz := statement_timestamp();
  v_window timestamptz;
  v_ip_action text;
  v_token_action text;
  v_ip_limit integer;
  v_token_limit integer;
  v_count integer;
begin
  if p_action not in ('view', 'respond') then
    raise exception using errcode = '22023', message = 'PILOT_VALIDATION_FAILED';
  end if;
  begin
    v_token_hash := private.decode_pilot_sha256_hex(
      p_public_token_hash_hex, 'PUBLIC_QUOTE_LINK_INVALID'
    );
  exception when others then
    v_token_hash := null;
  end;
  v_ip_hash := private.decode_pilot_sha256_hex(
    p_client_ip_hash_hex, 'PILOT_VALIDATION_FAILED'
  );

  if p_action = 'view' then
    v_window := date_bin(
      interval '10 minutes', v_now, timestamptz '2001-01-01 00:00:00+00'
    );
    v_ip_action := 'quote_view_ip';
    v_token_action := 'quote_view_token';
    v_ip_limit := 120;
    v_token_limit := 60;
  else
    v_window := date_bin(
      interval '1 hour', v_now, timestamptz '2001-01-01 00:00:00+00'
    );
    v_ip_action := 'quote_respond_ip';
    v_token_action := 'quote_respond_token';
    v_ip_limit := 10;
    v_token_limit := 5;
  end if;

  insert into private.pilot_public_quote_rate_limits (
    bucket_hash, action, window_started_at, request_count
  ) values (v_ip_hash, v_ip_action, v_window, 1)
  on conflict (bucket_hash, action, window_started_at)
  do update set
    request_count = least(private.pilot_public_quote_rate_limits.request_count + 1, 100000),
    updated_at = clock_timestamp()
  returning request_count into v_count;

  -- Keep the shared table bounded without requiring a scheduler for the Pilot.
  delete from private.pilot_public_quote_rate_limits
  where window_started_at < v_now - interval '2 days';

  if v_count > v_ip_limit then
    return 'limited';
  end if;

  select * into v_token
  from public.public_access_tokens pat
  where pat.token_hash = v_token_hash
    and pat.resource_type = 'quote'
    and pat.revoked_at is null
    and pat.expires_at > v_now
    and (pat.max_uses is null or pat.use_count < pat.max_uses)
    and case when p_action = 'view'
      then 'quote:read' = any(pat.scopes)
      else 'quote:respond' = any(pat.scopes)
    end
    and exists (
      select 1 from public.organizations o
      where o.id = pat.organization_id and o.status = 'active'
    );

  if not found then
    return 'invalid';
  end if;

  insert into private.pilot_public_quote_rate_limits (
    bucket_hash, action, window_started_at, request_count
  ) values (v_token.token_hash, v_token_action, v_window, 1)
  on conflict (bucket_hash, action, window_started_at)
  do update set
    request_count = least(private.pilot_public_quote_rate_limits.request_count + 1, 100000),
    updated_at = clock_timestamp()
  returning request_count into v_count;

  if v_count > v_token_limit then
    return 'limited';
  end if;
  return 'allowed';
end;
$$;

alter function public.consume_pilot_public_quote_rate_limit(text, text, text)
  owner to renoly_rls_owner;
revoke all on function public.consume_pilot_public_quote_rate_limit(text, text, text)
  from public, anon, authenticated;
grant execute on function public.consume_pilot_public_quote_rate_limit(text, text, text)
  to service_role;

create or replace function public.resolve_pilot_public_quote(
  p_public_token_hash_hex text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, extensions
as $$
declare
  v_hash bytea;
  v_token public.public_access_tokens%rowtype;
  v_quote public.quotes%rowtype;
  v_version public.quote_versions%rowtype;
  v_now timestamptz := statement_timestamp();
begin
  begin
    v_hash := private.decode_pilot_sha256_hex(
      p_public_token_hash_hex, 'PUBLIC_QUOTE_LINK_INVALID'
    );
  exception when others then
    raise exception using errcode = '42501', message = 'PUBLIC_QUOTE_LINK_INVALID';
  end;

  select * into v_token
  from public.public_access_tokens pat
  where pat.token_hash = v_hash
  for update;
  if not found
     or v_token.resource_type <> 'quote'
     or not ('quote:read' = any(v_token.scopes))
     or v_token.revoked_at is not null
     or v_token.expires_at <= v_now
     or (v_token.max_uses is not null and v_token.use_count >= v_token.max_uses)
     or not exists (
       select 1 from public.organizations o
       where o.id = v_token.organization_id and o.status = 'active'
     ) then
    raise exception using errcode = '42501', message = 'PUBLIC_QUOTE_LINK_INVALID';
  end if;

  select q.* into v_quote
  from public.quote_versions qv
  join public.quotes q
    on q.organization_id = qv.organization_id and q.id = qv.quote_id
  where qv.organization_id = v_token.organization_id
    and qv.id = v_token.resource_id
    and q.active_version_id = qv.id
    and q.status in ('sent', 'viewed', 'accepted', 'rejected')
    and qv.status in ('sent', 'accepted', 'rejected')
    and qv.approval_status = 'approved'
  for update of q;
  if not found then
    raise exception using errcode = '42501', message = 'PUBLIC_QUOTE_LINK_INVALID';
  end if;
  select * into v_version
  from public.quote_versions
  where organization_id = v_token.organization_id and id = v_token.resource_id;

  update public.public_access_tokens
  set use_count = use_count + 1, last_used_at = v_now
  where id = v_token.id;

  if v_quote.status = 'sent' then
    update public.quotes
    set status = 'viewed', first_viewed_at = coalesce(first_viewed_at, v_now),
        lock_version = lock_version + 1
    where organization_id = v_quote.organization_id and id = v_quote.id;

    perform private.append_customer_event(
      v_quote.organization_id, v_quote.customer_id, 'quote', v_quote.id,
      'quote.viewed', jsonb_build_object('quoteVersionId', v_version.id),
      null, null, v_now
    );
  end if;

  return private.pilot_public_quote_json(v_quote.organization_id, v_version.id);
end;
$$;

alter function public.resolve_pilot_public_quote(text) owner to renoly_rls_owner;
revoke all on function public.resolve_pilot_public_quote(text)
  from public, anon, authenticated;
grant execute on function public.resolve_pilot_public_quote(text) to service_role;

create or replace function public.respond_pilot_public_quote(
  p_public_token_hash_hex text,
  p_idempotency_key text,
  p_payload jsonb,
  p_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, extensions
as $$
declare
  v_hash bytea;
  v_token public.public_access_tokens%rowtype;
  v_quote public.quotes%rowtype;
  v_version public.quote_versions%rowtype;
  v_decision text;
  v_version_id uuid;
  v_display_name text;
  v_comment text;
  v_now timestamptz := statement_timestamp();
  v_today date;
  v_timezone text;
  v_actor_fingerprint text;
  v_request_hash text;
  v_idempotency public.idempotency_keys%rowtype;
  v_inserted integer;
  v_response jsonb;
  v_existing_event public.events%rowtype;
begin
  begin
    v_hash := private.decode_pilot_sha256_hex(
      p_public_token_hash_hex, 'PUBLIC_QUOTE_LINK_INVALID'
    );
  exception when others then
    raise exception using errcode = '42501', message = 'PUBLIC_QUOTE_LINK_INVALID';
  end;

  if nullif(btrim(p_idempotency_key), '') is null
     or char_length(p_idempotency_key) not between 8 and 128
     or p_payload is null
     or jsonb_typeof(p_payload) <> 'object'
     or not (p_payload ?& array['decision', 'displayName', 'comment'])
     or exists (
       select 1 from jsonb_object_keys(p_payload) key
       where key <> all(array['decision', 'displayName', 'comment'])
     ) then
    raise exception using errcode = '22023', message = 'PILOT_VALIDATION_FAILED';
  end if;

  v_decision := p_payload ->> 'decision';
  v_display_name := btrim(p_payload ->> 'displayName');
  v_comment := nullif(btrim(p_payload ->> 'comment'), '');
  if v_decision not in ('accept', 'reject')
     or nullif(v_display_name, '') is null
     or char_length(v_display_name) > 120
     or char_length(coalesce(v_comment, '')) > 2000 then
    raise exception using errcode = '22023', message = 'PILOT_VALIDATION_FAILED';
  end if;

  select * into v_token
  from public.public_access_tokens pat
  where pat.token_hash = v_hash
  for update;
  if not found
     or v_token.resource_type <> 'quote'
     or not ('quote:respond' = any(v_token.scopes))
     or v_token.revoked_at is not null
     or v_token.expires_at <= v_now
     or (v_token.max_uses is not null and v_token.use_count >= v_token.max_uses)
     or not exists (
       select 1 from public.organizations o
       where o.id = v_token.organization_id and o.status = 'active'
     ) then
    raise exception using errcode = '42501', message = 'PUBLIC_QUOTE_LINK_INVALID';
  end if;
  v_version_id := v_token.resource_id;

  v_actor_fingerprint := 'public-quote:' || v_token.id::text;
  v_request_hash := encode(extensions.digest(p_payload::text, 'sha256'), 'hex');
  insert into public.idempotency_keys (
    organization_id, actor_fingerprint, method, path_template,
    idempotency_key, request_hash, state, resource_type, resource_id,
    locked_until, expires_at
  ) values (
    v_token.organization_id, v_actor_fingerprint, 'POST',
    '/api/v2/public/quotes/current/responses', p_idempotency_key,
    v_request_hash, 'processing', 'quote_version', v_version_id,
    clock_timestamp() + interval '2 minutes', clock_timestamp() + interval '30 days'
  )
  on conflict (actor_fingerprint, method, path_template, idempotency_key) do nothing
  returning * into v_idempotency;
  get diagnostics v_inserted = row_count;

  if v_inserted = 0 then
    select * into v_idempotency
    from public.idempotency_keys
    where actor_fingerprint = v_actor_fingerprint
      and method = 'POST'
      and path_template = '/api/v2/public/quotes/current/responses'
      and idempotency_key = p_idempotency_key
    for update;
    if v_idempotency.request_hash is distinct from v_request_hash then
      raise exception using errcode = '22023', message = 'PILOT_IDEMPOTENCY_CONFLICT';
    end if;
    if v_idempotency.state = 'completed' and v_idempotency.response_body is not null then
      return v_idempotency.response_body || jsonb_build_object('replayed', true);
    end if;
    raise exception using errcode = '22023', message = 'PILOT_IDEMPOTENCY_IN_PROGRESS';
  end if;

  select q.* into v_quote
  from public.quote_versions qv
  join public.quotes q
    on q.organization_id = qv.organization_id and q.id = qv.quote_id
  where qv.organization_id = v_token.organization_id
    and qv.id = v_version_id
    and q.active_version_id = qv.id
  for update of q;
  if not found then
    raise exception using errcode = '42501', message = 'PUBLIC_QUOTE_LINK_INVALID';
  end if;
  select * into v_version
  from public.quote_versions
  where organization_id = v_token.organization_id and id = v_version_id
  for update;
  select timezone into v_timezone
  from public.organizations where id = v_token.organization_id;

  if v_quote.status in ('accepted', 'rejected') then
    select * into v_existing_event
    from public.events e
    where e.organization_id = v_quote.organization_id
      and e.aggregate_type = 'quote' and e.aggregate_id = v_quote.id
      and e.event_type in ('quote.accepted', 'quote.rejected')
    order by e.chain_sequence desc limit 1;

    if v_existing_event.payload ->> 'decision' = v_decision
       and v_existing_event.payload ->> 'quoteVersionId' = v_version_id::text then
      v_response := jsonb_build_object(
        'decision', v_decision,
        'recordedAt', v_existing_event.occurred_at,
        'displayName', v_existing_event.payload ->> 'displayName',
        'comment', v_existing_event.payload -> 'comment',
        'replayed', true
      );
      update public.idempotency_keys
      set state = 'completed', response_status = 200, response_body = v_response,
          locked_until = null, updated_at = clock_timestamp()
      where id = v_idempotency.id;
      return v_response;
    end if;
    raise exception using errcode = '23514', message = 'QUOTE_ALREADY_RESOLVED';
  end if;

  if v_quote.status not in ('sent', 'viewed')
     or v_version.status <> 'sent'
     or v_version.approval_status <> 'approved' then
    raise exception using errcode = '23514', message = 'QUOTE_NOT_RESPONDABLE';
  end if;
  v_today := (v_now at time zone v_timezone)::date;
  if v_version.valid_until is not null and v_version.valid_until < v_today then
    raise exception using errcode = '23514', message = 'QUOTE_EXPIRED';
  end if;

  update public.quote_versions
  set status = case when v_decision = 'accept' then 'accepted' else 'rejected' end,
      accepted_at = case when v_decision = 'accept' then v_now else null end,
      rejected_at = case when v_decision = 'reject' then v_now else null end,
      lock_version = lock_version + 1
  where organization_id = v_quote.organization_id and id = v_version.id;

  update public.quotes
  set status = case when v_decision = 'accept' then 'accepted' else 'rejected' end,
      accepted_version_id = case when v_decision = 'accept' then v_version.id else null end,
      accepted_at = case when v_decision = 'accept' then v_now else null end,
      rejected_at = case when v_decision = 'reject' then v_now else null end,
      rejection_reason = case when v_decision = 'reject' then coalesce(v_comment, '客戶未提供原因') else null end,
      lock_version = lock_version + 1
  where organization_id = v_quote.organization_id and id = v_quote.id;

  update public.service_requests
  set status = case when v_decision = 'reject' then 'quoting' else status end,
      lock_version = lock_version + 1
  where organization_id = v_quote.organization_id and id = v_quote.service_request_id;

  perform private.append_customer_event(
    v_quote.organization_id, v_quote.customer_id, 'quote', v_quote.id,
    case when v_decision = 'accept' then 'quote.accepted' else 'quote.rejected' end,
    jsonb_build_object(
      'decision', v_decision,
      'quoteVersionId', v_version.id,
      'versionNo', v_version.version_no,
      'displayName', v_display_name,
      'comment', v_comment,
      'totalMinor', v_version.total_minor
    ), p_request_id, p_idempotency_key, v_now
  );
  perform private.append_customer_event(
    v_quote.organization_id, v_quote.customer_id, 'service_request',
    v_quote.service_request_id,
    case when v_decision = 'accept'
      then 'service_request.quote_accepted'
      else 'service_request.quote_rejected'
    end,
    jsonb_build_object(
      'decision', v_decision,
      'quoteId', v_quote.id,
      'quoteVersionId', v_version.id
    ), p_request_id, p_idempotency_key, v_now
  );

  update public.public_access_tokens
  set use_count = use_count + 1, last_used_at = v_now
  where id = v_token.id;

  v_response := jsonb_build_object(
    'decision', v_decision,
    'recordedAt', v_now,
    'displayName', v_display_name,
    'comment', v_comment,
    'replayed', false
  );
  update public.idempotency_keys
  set state = 'completed', response_status = 200, response_body = v_response,
      locked_until = null, updated_at = clock_timestamp()
  where id = v_idempotency.id;
  return v_response;
exception
  when invalid_text_representation then
    raise exception using errcode = '22023', message = 'PILOT_VALIDATION_FAILED';
end;
$$;

alter function public.respond_pilot_public_quote(text, text, jsonb, uuid)
  owner to renoly_rls_owner;
revoke all on function public.respond_pilot_public_quote(text, text, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.respond_pilot_public_quote(text, text, jsonb, uuid)
  to service_role;

-------------------------------------------------------------------------------
-- Once a request has entered the quote lifecycle, conversion must reference an
-- accepted quote. Requests with no quote keep the explicit M3 no-quote path.
-------------------------------------------------------------------------------

create or replace function private.require_accepted_quote_before_conversion()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  if new.status = 'converted' and old.status <> 'converted'
     and exists (
       select 1 from public.quotes q
       where q.organization_id = new.organization_id
         and q.service_request_id = new.id
         and q.status in ('sent', 'viewed', 'rejected')
     )
     and not exists (
       select 1 from public.quotes q
       where q.organization_id = new.organization_id
         and q.service_request_id = new.id
         and q.status = 'accepted'
         and q.accepted_version_id is not null
     ) then
    raise exception using errcode = '23514', message = 'QUOTE_ACCEPTANCE_REQUIRED';
  end if;
  return new;
end;
$$;

alter function private.require_accepted_quote_before_conversion() owner to renoly_rls_owner;
revoke all on function private.require_accepted_quote_before_conversion()
  from public, anon, authenticated, service_role;

create trigger b_m4_quote_acceptance_conversion_gate
before update of status on public.service_requests
for each row execute function private.require_accepted_quote_before_conversion();
