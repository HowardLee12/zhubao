-- Renoly v2 pilot vertical slice: authenticated onboarding and a service-role-only
-- public intake boundary. Raw capability tokens and client IPs never enter SQL;
-- callers provide SHA-256 hex digests and all base tables remain RPC-only.

create table private.pilot_intake_uploads (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  token_id uuid not null,
  intake_id uuid not null,
  ip_hash bytea not null,
  storage_bucket text not null default 'v2-intake-photos',
  storage_path text not null,
  original_filename text not null,
  declared_mime_type text not null,
  declared_byte_size bigint not null,
  declared_sha256 text not null,
  actual_mime_type text,
  actual_byte_size bigint,
  actual_sha256 text,
  image_width integer,
  image_height integer,
  status text not null default 'pending',
  expires_at timestamptz not null,
  ready_at timestamptz,
  consumed_at timestamptz,
  service_request_id uuid,
  created_at timestamptz not null default clock_timestamp(),
  constraint pilot_intake_uploads_org_id_uidx unique (organization_id, id),
  constraint pilot_intake_uploads_token_fk foreign key (organization_id, token_id)
    references public.public_access_tokens (organization_id, id) on delete restrict,
  constraint pilot_intake_uploads_request_fk foreign key (organization_id, service_request_id)
    references public.service_requests (organization_id, id) on delete restrict,
  constraint pilot_intake_uploads_storage_path_uidx unique (storage_path),
  constraint pilot_intake_uploads_ip_hash_chk check (octet_length(ip_hash) = 32),
  constraint pilot_intake_uploads_bucket_chk check (storage_bucket = 'v2-intake-photos'),
  constraint pilot_intake_uploads_path_length_chk check (char_length(storage_path) between 1 and 1000),
  constraint pilot_intake_uploads_filename_chk check (char_length(original_filename) between 1 and 200),
  constraint pilot_intake_uploads_declared_mime_chk check (
    declared_mime_type in ('image/jpeg', 'image/png', 'image/webp')
  ),
  constraint pilot_intake_uploads_declared_size_chk check (declared_byte_size between 1 and 10485760),
  constraint pilot_intake_uploads_declared_sha_chk check (declared_sha256 ~ '^[0-9a-f]{64}$'),
  constraint pilot_intake_uploads_actual_mime_chk check (
    actual_mime_type is null or actual_mime_type in ('image/jpeg', 'image/png', 'image/webp')
  ),
  constraint pilot_intake_uploads_actual_size_chk check (
    actual_byte_size is null or actual_byte_size between 1 and 10485760
  ),
  constraint pilot_intake_uploads_actual_sha_chk check (
    actual_sha256 is null or actual_sha256 ~ '^[0-9a-f]{64}$'
  ),
  constraint pilot_intake_uploads_dimensions_chk check (
    (image_width is null or image_width between 1 and 10000)
    and (image_height is null or image_height between 1 and 10000)
    and (
      image_width is null or image_height is null
      or image_width::bigint * image_height::bigint <= 25000000
    )
  ),
  constraint pilot_intake_uploads_status_chk check (status in ('pending', 'ready', 'consumed')),
  constraint pilot_intake_uploads_expiry_chk check (expires_at > created_at),
  constraint pilot_intake_uploads_ready_shape_chk check (
    status = 'pending'
    or (
      ready_at is not null and actual_mime_type is not null and actual_byte_size is not null
      and actual_sha256 is not null and image_width is not null and image_height is not null
    )
  ),
  constraint pilot_intake_uploads_consumed_shape_chk check (
    status <> 'consumed'
    or (consumed_at is not null and service_request_id is not null)
  )
);

create index pilot_intake_uploads_session_idx
  on private.pilot_intake_uploads (organization_id, token_id, intake_id, status, created_at, id);
create index pilot_intake_uploads_expiry_idx
  on private.pilot_intake_uploads (expires_at, id) where status <> 'consumed';

create table private.pilot_intake_rate_limits (
  organization_id uuid not null references public.organizations(id) on delete restrict,
  token_id uuid not null,
  ip_hash bytea not null,
  action text not null,
  window_started_at timestamptz not null,
  request_count integer not null default 1,
  updated_at timestamptz not null default clock_timestamp(),
  primary key (token_id, ip_hash, action, window_started_at),
  constraint pilot_intake_rate_limits_token_fk foreign key (organization_id, token_id)
    references public.public_access_tokens (organization_id, id) on delete restrict,
  constraint pilot_intake_rate_limits_ip_hash_chk check (octet_length(ip_hash) = 32),
  constraint pilot_intake_rate_limits_action_chk check (action in ('submit')),
  constraint pilot_intake_rate_limits_count_chk check (request_count between 1 and 100000)
);

create index pilot_intake_rate_limits_window_idx
  on private.pilot_intake_rate_limits (window_started_at, token_id);

alter table private.pilot_intake_uploads owner to renoly_rls_owner;
alter table private.pilot_intake_rate_limits owner to renoly_rls_owner;
alter table private.pilot_intake_uploads enable row level security;
alter table private.pilot_intake_uploads force row level security;
alter table private.pilot_intake_rate_limits enable row level security;
alter table private.pilot_intake_rate_limits force row level security;
revoke all on private.pilot_intake_uploads from public, anon, authenticated, service_role;
revoke all on private.pilot_intake_rate_limits from public, anon, authenticated, service_role;

insert into storage.buckets (
  id, name, public, file_size_limit, allowed_mime_types
) values (
  'v2-intake-photos', 'v2-intake-photos', false, 10485760,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types,
    updated_at = statement_timestamp();

create or replace function private.decode_pilot_sha256_hex(
  p_hash_hex text,
  p_error_message text
)
returns bytea
language plpgsql
immutable
set search_path = pg_catalog
as $$
begin
  if p_hash_hex is null or p_hash_hex !~ '^[0-9A-Fa-f]{64}$' then
    raise exception using errcode = '22023', message = p_error_message;
  end if;
  return decode(lower(p_hash_hex), 'hex');
end;
$$;

alter function private.decode_pilot_sha256_hex(text, text) owner to renoly_rls_owner;
revoke all on function private.decode_pilot_sha256_hex(text, text)
  from public, anon, authenticated, service_role;

create or replace function private.require_pilot_intake_token(
  p_public_intake_token_hash_hex text,
  p_required_scope text
)
returns public.public_access_tokens
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_hash bytea;
  v_token public.public_access_tokens%rowtype;
begin
  if p_public_intake_token_hash_hex is null
     or p_public_intake_token_hash_hex !~ '^[0-9A-Fa-f]{64}$' then
    raise exception using errcode = '42501', message = 'PILOT_PUBLIC_LINK_NOT_FOUND';
  end if;

  v_hash := decode(lower(p_public_intake_token_hash_hex), 'hex');

  select pat.* into v_token
  from public.public_access_tokens pat
  join public.organizations o on o.id = pat.organization_id and o.status = 'active'
  where pat.token_hash = v_hash
    and pat.resource_type = 'intake_form'
    and pat.resource_id = pat.organization_id
    and pat.revoked_at is null
    and pat.expires_at > statement_timestamp()
    and p_required_scope = any(pat.scopes)
    and (pat.max_uses is null or pat.use_count < pat.max_uses)
  for share of pat;

  if not found then
    raise exception using errcode = '42501', message = 'PILOT_PUBLIC_LINK_NOT_FOUND';
  end if;

  return v_token;
end;
$$;

alter function private.require_pilot_intake_token(text, text) owner to renoly_rls_owner;
revoke all on function private.require_pilot_intake_token(text, text)
  from public, anon, authenticated, service_role;

create or replace function public.create_pilot_organization(
  p_name text,
  p_slug text,
  p_industry_template text,
  p_timezone text,
  p_currency text,
  p_owner_display_name text,
  p_public_intake_token_hash_hex text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_actor uuid := (select private.current_actor_user_id());
  v_org_id uuid := gen_random_uuid();
  v_membership_id uuid := gen_random_uuid();
  v_catalog_id uuid := gen_random_uuid();
  v_token_hash bytea;
  v_catalog_name text;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;

  if nullif(btrim(p_name), '') is null or char_length(btrim(p_name)) > 120
     or p_slug is null or p_slug <> lower(p_slug)
     or p_slug !~ '^[a-z0-9][a-z0-9-]{0,48}[a-z0-9]$'
     or p_industry_template not in (
       'general_field_service', 'cooling', 'plumbing', 'waterproofing', 'renovation'
     )
     or nullif(btrim(p_timezone), '') is null or char_length(p_timezone) > 64
     or not exists (select 1 from pg_timezone_names where name = p_timezone)
     or p_currency is null or p_currency !~ '^[A-Z]{3}$'
     or nullif(btrim(p_owner_display_name), '') is null
     or char_length(btrim(p_owner_display_name)) > 80 then
    raise exception using errcode = '22023', message = 'PILOT_VALIDATION_FAILED';
  end if;

  v_token_hash := private.decode_pilot_sha256_hex(
    p_public_intake_token_hash_hex, 'PILOT_VALIDATION_FAILED'
  );
  v_catalog_name := case p_industry_template
    when 'cooling' then '冷氣服務目錄'
    when 'plumbing' then '水電服務目錄'
    when 'waterproofing' then '防水抓漏服務目錄'
    when 'renovation' then '小型裝修服務目錄'
    else '到府工程服務目錄'
  end;

  insert into public.organizations (
    id, slug, name, industry_template, timezone, currency, settings,
    created_by, updated_by
  ) values (
    v_org_id, p_slug, btrim(p_name), p_industry_template, p_timezone, p_currency,
    jsonb_build_object(
      'intakeEnabled', true,
      'responseTimeMinutes', 60,
      'serviceAreas', '[]'::jsonb,
      'businessHours', '{}'::jsonb,
      'intakeHeadline', '告訴我們需要協助的工程服務',
      'privacyNotice', '送出即表示您同意店家為聯絡、報價與派工目的使用本次提供的資料。'
    ),
    v_actor, v_actor
  );

  insert into public.memberships (
    id, organization_id, user_id, role, status, display_name,
    joined_at, created_by, updated_by
  ) values (
    v_membership_id, v_org_id, v_actor, 'owner', 'active',
    btrim(p_owner_display_name), statement_timestamp(), v_actor, v_actor
  );

  insert into public.service_catalogs (
    id, organization_id, name, description, industry_template,
    is_default, is_active, created_by, updated_by
  ) values (
    v_catalog_id, v_org_id, v_catalog_name, 'Renoly Pilot 預設服務，可於設定中調整。',
    p_industry_template, true, true, v_actor, v_actor
  );

  insert into public.service_catalog_items (
    organization_id, service_catalog_id, code, category, name,
    description, unit, default_cost_minor, default_price_minor,
    sort_order, created_by, updated_by
  )
  select
    v_org_id, v_catalog_id, seed.code, seed.category, seed.name,
    seed.description, seed.unit, 0, 0, seed.sort_order, v_actor, v_actor
  from (values
    ('general_field_service', 'SITE-VISIT', '到府服務', '現場勘查', '到場確認需求與施工條件', '次', 10),
    ('general_field_service', 'FIELD-REPAIR', '到府服務', '維修服務', '到府檢查與維修', '式', 20),
    ('general_field_service', 'SMALL-PROJECT', '小型工程', '小型工程估價', '丈量、評估與工程報價', '案', 30),
    ('cooling', 'AC-CLEAN', '冷氣', '冷氣清洗', '分離式或窗型冷氣清潔保養', '台', 10),
    ('cooling', 'AC-REPAIR', '冷氣', '冷氣檢修', '異常檢查與維修評估', '台', 20),
    ('cooling', 'AC-INSTALL', '冷氣', '冷氣安裝評估', '現場丈量與安裝報價', '式', 30),
    ('plumbing', 'PLUMBING-REPAIR', '水電', '水電維修', '漏水、堵塞與一般水電故障', '式', 10),
    ('plumbing', 'ELECTRICAL-REPAIR', '水電', '電路檢修', '插座、照明與電路異常檢查', '式', 20),
    ('plumbing', 'PLUMBING-SURVEY', '水電', '現場勘查', '較大工程現場丈量與報價', '次', 30),
    ('waterproofing', 'LEAK-INSPECTION', '防水抓漏', '漏水檢測', '現場檢查漏水來源與範圍', '次', 10),
    ('waterproofing', 'WATERPROOF-REPAIR', '防水抓漏', '局部防水修繕', '局部區域防水修繕評估', '式', 20),
    ('waterproofing', 'ROOF-WATERPROOF', '防水抓漏', '屋頂防水評估', '屋頂丈量與防水工程報價', '案', 30),
    ('renovation', 'RENOVATION-SURVEY', '小型裝修', '現場丈量', '到場丈量並確認需求', '次', 10),
    ('renovation', 'SMALL-REPAIR', '小型裝修', '局部修繕', '牆面、天花或木作局部修繕', '式', 20),
    ('renovation', 'RENOVATION-QUOTE', '小型裝修', '工程估價', '彙整工項與提出報價', '案', 30)
  ) as seed(template, code, category, name, description, unit, sort_order)
  where seed.template = p_industry_template;

  insert into public.public_access_tokens (
    organization_id, resource_type, resource_id, token_hash, scopes,
    expires_at, max_uses, created_by
  ) values (
    v_org_id, 'intake_form', v_org_id, v_token_hash,
    array['intake:create', 'intake:upload']::text[],
    statement_timestamp() + interval '365 days', null, v_actor
  );

  return jsonb_build_object(
    'organization', jsonb_build_object(
      'id', v_org_id,
      'name', btrim(p_name),
      'slug', p_slug,
      'industryTemplate', p_industry_template,
      'timezone', p_timezone,
      'currency', p_currency
    ),
    'membership', jsonb_build_object(
      'id', v_membership_id,
      'organizationId', v_org_id,
      'role', 'owner',
      'status', 'active',
      'displayName', btrim(p_owner_display_name)
    )
  );
exception
  when unique_violation then
    raise exception using errcode = '23505', message = 'PILOT_ORGANIZATION_CONFLICT';
end;
$$;

alter function public.create_pilot_organization(text, text, text, text, text, text, text)
  owner to renoly_rls_owner;
revoke all on function public.create_pilot_organization(text, text, text, text, text, text, text)
  from public, anon, service_role;
grant execute on function public.create_pilot_organization(text, text, text, text, text, text, text)
  to authenticated;

create or replace function public.get_pilot_session()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_actor uuid := (select private.current_actor_user_id());
  v_memberships jsonb;
  v_active_org uuid;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;

  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', m.id,
          'organizationId', o.id,
          'organizationName', o.name,
          'organizationSlug', o.slug,
          'role', m.role,
          'status', m.status
        ) order by coalesce(m.joined_at, m.created_at), m.id
      ),
      '[]'::jsonb
    ),
    (array_agg(o.id order by coalesce(m.joined_at, m.created_at), m.id))[1]
  into v_memberships, v_active_org
  from public.memberships m
  join public.organizations o on o.id = m.organization_id
  where m.user_id = v_actor and m.status = 'active' and o.status = 'active';

  return jsonb_build_object(
    'memberships', v_memberships,
    'activeOrganizationId', v_active_org
  );
end;
$$;

alter function public.get_pilot_session() owner to renoly_rls_owner;
revoke all on function public.get_pilot_session() from public, anon, service_role;
grant execute on function public.get_pilot_session() to authenticated;

create or replace function public.list_pilot_service_requests(
  p_organization_id uuid,
  p_page_size integer default 50
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
  if p_page_size is null or p_page_size not between 1 and 100 then
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
        'serviceCatalogItemId', sci.id,
        'serviceName', sci.name,
        'category', sci.category,
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
    order by sr.created_at desc, sr.id desc
    limit p_page_size
  ) inbox_rows;

  return jsonb_build_object('organizationId', p_organization_id, 'items', v_items);
end;
$$;

alter function public.list_pilot_service_requests(uuid, integer) owner to renoly_rls_owner;
revoke all on function public.list_pilot_service_requests(uuid, integer)
  from public, anon, service_role;
grant execute on function public.list_pilot_service_requests(uuid, integer) to authenticated;

create or replace function public.get_pilot_organization_settings(
  p_organization_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_org public.organizations%rowtype;
begin
  if not public.has_org_role(
    p_organization_id, array['owner', 'admin']::text[]
  ) then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;

  select * into v_org
  from public.organizations
  where id = p_organization_id and status = 'active';
  if not found then
    raise exception using errcode = 'P0002', message = 'PILOT_ORGANIZATION_NOT_FOUND';
  end if;

  return jsonb_build_object(
    'organizationId', v_org.id,
    'name', v_org.name,
    'industryTemplate', v_org.industry_template,
    'intakeHeadline', coalesce(
      nullif(v_org.settings ->> 'intakeHeadline', ''),
      '告訴我們需要協助的工程服務'
    ),
    'privacyNotice', coalesce(
      nullif(v_org.settings ->> 'privacyNotice', ''),
      '送出即表示您同意店家為聯絡、報價與派工目的使用本次提供的資料。'
    ),
    'lockVersion', v_org.lock_version
  );
end;
$$;

alter function public.get_pilot_organization_settings(uuid) owner to renoly_rls_owner;
revoke all on function public.get_pilot_organization_settings(uuid)
  from public, anon, service_role;
grant execute on function public.get_pilot_organization_settings(uuid) to authenticated;

create or replace function public.update_pilot_organization_settings(
  p_organization_id uuid,
  p_settings_patch jsonb,
  p_expected_lock_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_org public.organizations%rowtype;
  v_name text;
  v_headline text;
  v_privacy text;
begin
  if not public.has_org_role(
    p_organization_id, array['owner', 'admin']::text[]
  ) then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;
  if p_settings_patch is null
     or jsonb_typeof(p_settings_patch) <> 'object'
     or p_settings_patch = '{}'::jsonb
     or exists (
       select 1 from jsonb_object_keys(p_settings_patch) key_name
       where key_name not in ('name', 'intakeHeadline', 'privacyNotice')
     )
     or (p_settings_patch ? 'name' and jsonb_typeof(p_settings_patch -> 'name') <> 'string')
     or (
       p_settings_patch ? 'intakeHeadline'
       and jsonb_typeof(p_settings_patch -> 'intakeHeadline') <> 'string'
     )
     or (
       p_settings_patch ? 'privacyNotice'
       and jsonb_typeof(p_settings_patch -> 'privacyNotice') <> 'string'
     ) then
    raise exception using errcode = '22023', message = 'PILOT_VALIDATION_FAILED';
  end if;

  select * into v_org
  from public.organizations
  where id = p_organization_id and status = 'active'
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'PILOT_ORGANIZATION_NOT_FOUND';
  end if;
  if v_org.lock_version is distinct from p_expected_lock_version then
    raise exception using errcode = '40001', message = 'STALE_VERSION';
  end if;

  v_name := case when p_settings_patch ? 'name'
    then btrim(p_settings_patch ->> 'name') else v_org.name end;
  v_headline := case when p_settings_patch ? 'intakeHeadline'
    then btrim(p_settings_patch ->> 'intakeHeadline')
    else coalesce(
      nullif(v_org.settings ->> 'intakeHeadline', ''),
      '告訴我們需要協助的工程服務'
    ) end;
  v_privacy := case when p_settings_patch ? 'privacyNotice'
    then btrim(p_settings_patch ->> 'privacyNotice')
    else coalesce(
      nullif(v_org.settings ->> 'privacyNotice', ''),
      '送出即表示您同意店家為聯絡、報價與派工目的使用本次提供的資料。'
    ) end;

  if char_length(v_name) not between 1 and 120
     or char_length(v_headline) not between 1 and 160
     or char_length(v_privacy) not between 1 and 2000 then
    raise exception using errcode = '22023', message = 'PILOT_VALIDATION_FAILED';
  end if;

  update public.organizations
  set name = v_name,
      settings = settings || jsonb_build_object(
        'intakeHeadline', v_headline,
        'privacyNotice', v_privacy
      ),
      updated_by = (select private.current_actor_user_id()),
      lock_version = lock_version + 1
  where id = p_organization_id
  returning * into v_org;

  return jsonb_build_object(
    'organizationId', v_org.id,
    'name', v_org.name,
    'industryTemplate', v_org.industry_template,
    'intakeHeadline', v_headline,
    'privacyNotice', v_privacy,
    'lockVersion', v_org.lock_version
  );
end;
$$;

alter function public.update_pilot_organization_settings(uuid, jsonb, integer)
  owner to renoly_rls_owner;
revoke all on function public.update_pilot_organization_settings(uuid, jsonb, integer)
  from public, anon, service_role;
grant execute on function public.update_pilot_organization_settings(uuid, jsonb, integer)
  to authenticated;

create or replace function public.rotate_pilot_intake_token(
  p_organization_id uuid,
  p_new_token_hash_hex text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_actor uuid := (select private.current_actor_user_id());
  v_token_id uuid := gen_random_uuid();
  v_token_hash bytea;
  v_expires_at timestamptz := statement_timestamp() + interval '365 days';
begin
  if not public.has_org_role(
    p_organization_id, array['owner', 'admin']::text[]
  ) then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;
  v_token_hash := private.decode_pilot_sha256_hex(
    p_new_token_hash_hex, 'PILOT_VALIDATION_FAILED'
  );

  update public.public_access_tokens
  set revoked_at = statement_timestamp()
  where organization_id = p_organization_id
    and resource_type = 'intake_form'
    and resource_id = p_organization_id
    and revoked_at is null;

  insert into public.public_access_tokens (
    id, organization_id, resource_type, resource_id, token_hash,
    scopes, expires_at, max_uses, created_by
  ) values (
    v_token_id, p_organization_id, 'intake_form', p_organization_id, v_token_hash,
    array['intake:create', 'intake:upload']::text[], v_expires_at, null, v_actor
  );

  return jsonb_build_object(
    'organizationId', p_organization_id,
    'rotatedAt', statement_timestamp(),
    'expiresAt', v_expires_at
  );
exception
  when unique_violation then
    raise exception using errcode = '23505', message = 'PILOT_PUBLIC_TOKEN_CONFLICT';
end;
$$;

alter function public.rotate_pilot_intake_token(uuid, text) owner to renoly_rls_owner;
revoke all on function public.rotate_pilot_intake_token(uuid, text)
  from public, anon, service_role;
grant execute on function public.rotate_pilot_intake_token(uuid, text) to authenticated;

create or replace function public.resolve_pilot_intake_config(
  p_public_intake_token_hash_hex text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_token public.public_access_tokens%rowtype;
  v_org public.organizations%rowtype;
  v_items jsonb;
begin
  v_token := private.require_pilot_intake_token(
    p_public_intake_token_hash_hex, 'intake:create'
  );

  select * into strict v_org from public.organizations where id = v_token.organization_id;
  if coalesce((v_org.settings ->> 'intakeEnabled')::boolean, true) is false then
    raise exception using errcode = '42501', message = 'PILOT_PUBLIC_LINK_NOT_FOUND';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object('id', sci.id, 'name', sci.name, 'category', sci.category)
      order by sci.sort_order, sci.name, sci.id
    ),
    '[]'::jsonb
  ) into v_items
  from public.service_catalog_items sci
  join public.service_catalogs sc
    on sc.organization_id = sci.organization_id and sc.id = sci.service_catalog_id
  where sci.organization_id = v_token.organization_id
    and sci.is_active and sc.is_active and sc.is_default;

  return jsonb_build_object(
    'organization', jsonb_build_object(
      'id', v_org.id,
      'name', v_org.name,
      'slug', v_org.slug
    ),
    'serviceCatalogItems', v_items
  );
end;
$$;

alter function public.resolve_pilot_intake_config(text) owner to renoly_rls_owner;
revoke all on function public.resolve_pilot_intake_config(text)
  from public, anon, authenticated;
grant execute on function public.resolve_pilot_intake_config(text) to service_role;

create or replace function public.create_pilot_intake_upload(
  p_public_intake_token_hash_hex text,
  p_intake_id uuid,
  p_client_ip_hash_hex text,
  p_original_filename text,
  p_declared_mime_type text,
  p_declared_byte_size bigint,
  p_declared_sha256 text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_token public.public_access_tokens%rowtype;
  v_ip_hash bytea;
  v_upload_id uuid := gen_random_uuid();
  v_storage_path text;
  v_expires_at timestamptz := clock_timestamp() + interval '30 minutes';
begin
  v_token := private.require_pilot_intake_token(
    p_public_intake_token_hash_hex, 'intake:upload'
  );
  v_ip_hash := private.decode_pilot_sha256_hex(
    p_client_ip_hash_hex, 'PILOT_VALIDATION_FAILED'
  );

  if p_intake_id is null
     or nullif(btrim(p_original_filename), '') is null
     or char_length(p_original_filename) > 200
     or p_declared_mime_type not in ('image/jpeg', 'image/png', 'image/webp')
     or p_declared_byte_size is null or p_declared_byte_size not between 1 and 10485760
     or p_declared_sha256 is null or p_declared_sha256 !~ '^[0-9A-Fa-f]{64}$' then
    raise exception using errcode = '22023', message = 'PILOT_VALIDATION_FAILED';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('pilot-intake:' || p_intake_id::text, 0)
  );

  if exists (select 1 from public.service_requests where id = p_intake_id)
     or exists (
       select 1 from private.pilot_intake_uploads u
       where u.intake_id = p_intake_id
         and (
           u.organization_id <> v_token.organization_id
           or u.token_id <> v_token.id
           or u.ip_hash <> v_ip_hash
         )
     )
     or (
       select count(*) from private.pilot_intake_uploads u
       where u.organization_id = v_token.organization_id
         and u.token_id = v_token.id
         and u.intake_id = p_intake_id
         and u.status <> 'consumed'
     ) >= 10 then
    raise exception using errcode = '42501', message = 'PILOT_UPLOAD_INVALID';
  end if;

  v_storage_path := 'org/' || v_token.organization_id::text
    || '/service-requests/' || p_intake_id::text
    || '/' || v_upload_id::text || '/upload';

  insert into private.pilot_intake_uploads (
    id, organization_id, token_id, intake_id, ip_hash,
    storage_path, original_filename, declared_mime_type,
    declared_byte_size, declared_sha256, expires_at
  ) values (
    v_upload_id, v_token.organization_id, v_token.id, p_intake_id, v_ip_hash,
    v_storage_path, btrim(p_original_filename), p_declared_mime_type,
    p_declared_byte_size, lower(p_declared_sha256), v_expires_at
  );

  return jsonb_build_object(
    'uploadId', v_upload_id,
    'submissionId', p_intake_id,
    'storageBucket', 'v2-intake-photos',
    'storagePath', v_storage_path,
    'status', 'pending',
    'expiresAt', v_expires_at,
    'maxByteSize', 10485760
  );
end;
$$;

alter function public.create_pilot_intake_upload(text, uuid, text, text, text, bigint, text)
  owner to renoly_rls_owner;
revoke all on function public.create_pilot_intake_upload(text, uuid, text, text, text, bigint, text)
  from public, anon, authenticated;
grant execute on function public.create_pilot_intake_upload(text, uuid, text, text, text, bigint, text)
  to service_role;

create or replace function public.get_pilot_intake_upload_verification(
  p_public_intake_token_hash_hex text,
  p_intake_id uuid,
  p_upload_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_token public.public_access_tokens%rowtype;
  v_upload private.pilot_intake_uploads%rowtype;
begin
  v_token := private.require_pilot_intake_token(
    p_public_intake_token_hash_hex, 'intake:upload'
  );

  select * into v_upload
  from private.pilot_intake_uploads u
  where u.id = p_upload_id
    and u.organization_id = v_token.organization_id
    and u.token_id = v_token.id
    and u.intake_id = p_intake_id
    and u.status in ('pending', 'ready')
    and u.expires_at > statement_timestamp();

  if not found then
    raise exception using errcode = 'P0002', message = 'PILOT_UPLOAD_NOT_FOUND';
  end if;

  return jsonb_build_object(
    'uploadId', v_upload.id,
    'storageBucket', v_upload.storage_bucket,
    'storagePath', v_upload.storage_path,
    'declaredMimeType', v_upload.declared_mime_type,
    'declaredByteSize', v_upload.declared_byte_size,
    'declaredSha256', v_upload.declared_sha256,
    'status', v_upload.status,
    'expiresAt', v_upload.expires_at
  );
end;
$$;

alter function public.get_pilot_intake_upload_verification(text, uuid, uuid)
  owner to renoly_rls_owner;
revoke all on function public.get_pilot_intake_upload_verification(text, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.get_pilot_intake_upload_verification(text, uuid, uuid)
  to service_role;

create or replace function public.complete_pilot_intake_upload(
  p_public_intake_token_hash_hex text,
  p_intake_id uuid,
  p_upload_id uuid,
  p_actual_mime_type text,
  p_actual_byte_size bigint,
  p_actual_sha256 text,
  p_image_width integer,
  p_image_height integer
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_token public.public_access_tokens%rowtype;
  v_upload private.pilot_intake_uploads%rowtype;
begin
  v_token := private.require_pilot_intake_token(
    p_public_intake_token_hash_hex, 'intake:upload'
  );

  if p_actual_mime_type not in ('image/jpeg', 'image/png', 'image/webp')
     or p_actual_byte_size is null or p_actual_byte_size not between 1 and 10485760
     or p_actual_sha256 is null or p_actual_sha256 !~ '^[0-9A-Fa-f]{64}$'
     or p_image_width is null or p_image_width not between 1 and 10000
     or p_image_height is null or p_image_height not between 1 and 10000
     or p_image_width::bigint * p_image_height::bigint > 25000000 then
    raise exception using errcode = '22023', message = 'PILOT_VALIDATION_FAILED';
  end if;

  select * into v_upload
  from private.pilot_intake_uploads u
  where u.id = p_upload_id
    and u.organization_id = v_token.organization_id
    and u.token_id = v_token.id
    and u.intake_id = p_intake_id
    and u.status = 'pending'
    and u.expires_at > statement_timestamp()
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'PILOT_UPLOAD_NOT_FOUND';
  end if;
  if v_upload.declared_mime_type <> p_actual_mime_type
     or v_upload.declared_byte_size <> p_actual_byte_size
     or v_upload.declared_sha256 <> lower(p_actual_sha256) then
    raise exception using errcode = '42501', message = 'PILOT_UPLOAD_INVALID';
  end if;

  update private.pilot_intake_uploads
  set actual_mime_type = p_actual_mime_type,
      actual_byte_size = p_actual_byte_size,
      actual_sha256 = lower(p_actual_sha256),
      image_width = p_image_width,
      image_height = p_image_height,
      status = 'ready',
      ready_at = clock_timestamp()
  where id = p_upload_id
  returning * into v_upload;

  return jsonb_build_object(
    'uploadId', v_upload.id,
    'status', v_upload.status,
    'byteSize', v_upload.actual_byte_size,
    'width', v_upload.image_width,
    'height', v_upload.image_height,
    'readyAt', v_upload.ready_at
  );
end;
$$;

alter function public.complete_pilot_intake_upload(text, uuid, uuid, text, bigint, text, integer, integer)
  owner to renoly_rls_owner;
revoke all on function public.complete_pilot_intake_upload(text, uuid, uuid, text, bigint, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.complete_pilot_intake_upload(text, uuid, uuid, text, bigint, text, integer, integer)
  to service_role;

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

  insert into public.service_requests (
    id, organization_id, request_no, customer_id, location_id, source,
    source_reference, contact_name, contact_phone, subject, description,
    priority, status, metadata
  ) values (
    p_intake_id, v_token.organization_id, v_request_no, v_customer_id, v_location_id,
    'web', 'pilot-intake:' || p_intake_id::text, v_contact_name, v_contact_phone,
    v_subject, v_description, 'normal', 'new',
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
  v_event_payload := jsonb_build_object(
    'requestNo', v_request_no,
    'source', 'web',
    'serviceCatalogItemId', v_service_item_id,
    'photoCount', v_photo_count
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
