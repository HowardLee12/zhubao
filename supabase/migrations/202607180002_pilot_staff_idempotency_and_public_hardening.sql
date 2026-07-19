-- Wave 2 hardening for the pilot vertical slice.
--
-- D4  Staff idempotency: create_pilot_organization and rotate_pilot_intake_token
--     now accept p_idempotency_key and replay through public.idempotency_keys,
--     modelled on submit_pilot_service_request in 0005. A retry with the same key
--     and canonical body replays the first response WITHOUT re-running side
--     effects (so a rotate retry can no longer silently revoke the just-issued
--     intake link); a different body under the same key is a 409-style conflict.
--
-- D5  Public-surface hardening:
--     * create_pilot_intake_upload gains a per token+IP hourly rate limit so a
--       link holder cannot mint unlimited signed upload URLs. The rate-limit
--       table's allowed actions are extended to include 'upload'.
--     * Intake tokens are minted with a finite max_uses cap instead of NULL
--       (unlimited), bounding how many submissions a single leaked link can make
--       while staying well above realistic pilot volume.

-- --------------------------------------------------------------------------
-- Rate-limit table: allow the 'upload' action alongside 'submit'.
-- --------------------------------------------------------------------------
alter table private.pilot_intake_rate_limits
  drop constraint pilot_intake_rate_limits_action_chk;
alter table private.pilot_intake_rate_limits
  add constraint pilot_intake_rate_limits_action_chk
    check (action in ('submit', 'upload'));

-- --------------------------------------------------------------------------
-- D4: create_pilot_organization with idempotent replay.
-- --------------------------------------------------------------------------
create or replace function public.create_pilot_organization(
  p_name text,
  p_slug text,
  p_industry_template text,
  p_timezone text,
  p_currency text,
  p_owner_display_name text,
  p_public_intake_token_hash_hex text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, extensions
as $$
declare
  v_actor uuid := (select private.current_actor_user_id());
  v_org_id uuid := gen_random_uuid();
  v_membership_id uuid := gen_random_uuid();
  v_catalog_id uuid := gen_random_uuid();
  v_token_hash bytea;
  v_catalog_name text;
  v_actor_fingerprint text;
  v_request_hash text;
  v_idempotency public.idempotency_keys%rowtype;
  v_inserted integer;
  v_response jsonb;
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
     or char_length(btrim(p_owner_display_name)) > 80
     or nullif(btrim(p_idempotency_key), '') is null
     or char_length(p_idempotency_key) not between 8 and 200 then
    raise exception using errcode = '22023', message = 'PILOT_VALIDATION_FAILED';
  end if;

  v_token_hash := private.decode_pilot_sha256_hex(
    p_public_intake_token_hash_hex, 'PILOT_VALIDATION_FAILED'
  );

  -- Idempotency guard: fingerprint by actor + operation. The request hash binds
  -- the canonical business inputs (not the one-time token hash, which is random
  -- per attempt and would otherwise make every genuine retry a conflict).
  v_actor_fingerprint := 'pilot-org:' || v_actor::text;
  v_request_hash := encode(
    extensions.digest(
      lower(p_slug) || '|' || btrim(p_name) || '|' || p_industry_template
        || '|' || p_timezone || '|' || p_currency || '|' || btrim(p_owner_display_name),
      'sha256'
    ),
    'hex'
  );

  insert into public.idempotency_keys (
    organization_id, actor_fingerprint, method, path_template,
    idempotency_key, request_hash, state,
    locked_until, expires_at
  ) values (
    null, v_actor_fingerprint, 'POST', '/api/v2/organizations',
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
      and path_template = '/api/v2/organizations'
      and idempotency_key = p_idempotency_key
    for update;

    if v_idempotency.request_hash is distinct from v_request_hash then
      raise exception using errcode = '22023', message = 'PILOT_IDEMPOTENCY_CONFLICT';
    end if;
    if v_idempotency.state = 'completed' and v_idempotency.response_body is not null then
      -- A retry that lost the original response arrives with a freshly minted
      -- capability token; its hash was never stored and the original raw token
      -- is unrecoverable (only its hash persisted). Store this attempt's hash
      -- for the recorded organization so every intake URL the API has ever
      -- returned stays resolvable. The next rotation revokes them all at once.
      if v_idempotency.resource_id is not null then
        insert into public.public_access_tokens (
          organization_id, resource_type, resource_id, token_hash, scopes,
          expires_at, max_uses, created_by
        )
        select
          v_idempotency.resource_id, 'intake_form', v_idempotency.resource_id,
          v_token_hash, array['intake:create', 'intake:upload']::text[],
          statement_timestamp() + interval '365 days',
          private.pilot_intake_token_max_uses(), v_actor
        where not exists (
          select 1 from public.public_access_tokens where token_hash = v_token_hash
        );
      end if;
      return v_idempotency.response_body;
    end if;
    raise exception using errcode = '22023', message = 'PILOT_IDEMPOTENCY_IN_PROGRESS';
  end if;

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
    statement_timestamp() + interval '365 days',
    private.pilot_intake_token_max_uses(), v_actor
  );

  v_response := jsonb_build_object(
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

  -- organization_id stays null: the reservation row predates the organization and
  -- private.protect_tenant_identity() forbids changing it after insert. The
  -- resource_type/resource_id pair still records the created organization.
  update public.idempotency_keys
  set state = 'completed', response_status = 201, response_body = v_response,
      resource_type = 'organization', resource_id = v_org_id,
      locked_until = null, updated_at = clock_timestamp()
  where id = v_idempotency.id;

  return v_response;
exception
  when unique_violation then
    raise exception using errcode = '23505', message = 'PILOT_ORGANIZATION_CONFLICT';
end;
$$;

alter function public.create_pilot_organization(text, text, text, text, text, text, text, text)
  owner to renoly_rls_owner;
revoke all on function public.create_pilot_organization(text, text, text, text, text, text, text, text)
  from public, anon, service_role;
grant execute on function public.create_pilot_organization(text, text, text, text, text, text, text, text)
  to authenticated;

-- Drop the superseded 7-argument overload so the RPC signature is unambiguous
-- and the old (idempotency-less) entry point is gone.
drop function if exists public.create_pilot_organization(text, text, text, text, text, text, text);

-- --------------------------------------------------------------------------
-- D5: shared helper for the finite intake-token submission cap.
-- --------------------------------------------------------------------------
create or replace function private.pilot_intake_token_max_uses()
returns integer
language sql
immutable
set search_path = pg_catalog
as $$
  -- Bounds how many submissions a single (possibly leaked) intake link can make
  -- over its lifetime. Comfortably above realistic pilot volume and the E2E
  -- journey, while removing the previous unlimited (NULL) behaviour.
  select 500;
$$;

alter function private.pilot_intake_token_max_uses() owner to renoly_rls_owner;
revoke all on function private.pilot_intake_token_max_uses()
  from public, anon, authenticated, service_role;

-- --------------------------------------------------------------------------
-- D4: rotate_pilot_intake_token with idempotent replay.
-- --------------------------------------------------------------------------
create or replace function public.rotate_pilot_intake_token(
  p_organization_id uuid,
  p_new_token_hash_hex text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, extensions
as $$
declare
  v_actor uuid := (select private.current_actor_user_id());
  v_token_id uuid := gen_random_uuid();
  v_token_hash bytea;
  v_expires_at timestamptz := statement_timestamp() + interval '365 days';
  v_actor_fingerprint text;
  v_request_hash text;
  v_idempotency public.idempotency_keys%rowtype;
  v_inserted integer;
  v_response jsonb;
begin
  if not public.has_org_role(
    p_organization_id, array['owner', 'admin']::text[]
  ) then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;

  if nullif(btrim(p_idempotency_key), '') is null
     or char_length(p_idempotency_key) not between 8 and 200 then
    raise exception using errcode = '22023', message = 'PILOT_VALIDATION_FAILED';
  end if;

  v_token_hash := private.decode_pilot_sha256_hex(
    p_new_token_hash_hex, 'PILOT_VALIDATION_FAILED'
  );

  -- The request hash binds the organization and the specific new token hash, so
  -- a genuine retry (which mints a fresh random token) is a body mismatch and is
  -- rejected as a conflict rather than revoking the freshly issued link again.
  v_actor_fingerprint := 'pilot-rotate:' || v_actor::text;
  v_request_hash := encode(
    extensions.digest(
      p_organization_id::text || '|' || encode(v_token_hash, 'hex'),
      'sha256'
    ),
    'hex'
  );

  insert into public.idempotency_keys (
    organization_id, actor_fingerprint, method, path_template,
    idempotency_key, request_hash, state,
    locked_until, expires_at
  ) values (
    p_organization_id, v_actor_fingerprint, 'POST',
    '/api/v2/organizations/{orgId}/public-intake-link/actions/rotate',
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
      and path_template = '/api/v2/organizations/{orgId}/public-intake-link/actions/rotate'
      and idempotency_key = p_idempotency_key
    for update;

    if v_idempotency.request_hash is distinct from v_request_hash then
      raise exception using errcode = '22023', message = 'PILOT_IDEMPOTENCY_CONFLICT';
    end if;
    if v_idempotency.state = 'completed' and v_idempotency.response_body is not null then
      return v_idempotency.response_body;
    end if;
    raise exception using errcode = '22023', message = 'PILOT_IDEMPOTENCY_IN_PROGRESS';
  end if;

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
    array['intake:create', 'intake:upload']::text[], v_expires_at,
    private.pilot_intake_token_max_uses(), v_actor
  );

  v_response := jsonb_build_object(
    'organizationId', p_organization_id,
    'rotatedAt', statement_timestamp(),
    'expiresAt', v_expires_at
  );

  update public.idempotency_keys
  set state = 'completed', response_status = 200, response_body = v_response,
      resource_type = 'public_access_token', resource_id = v_token_id,
      locked_until = null, updated_at = clock_timestamp()
  where id = v_idempotency.id;

  return v_response;
exception
  when unique_violation then
    raise exception using errcode = '23505', message = 'PILOT_PUBLIC_TOKEN_CONFLICT';
end;
$$;

alter function public.rotate_pilot_intake_token(uuid, text, text) owner to renoly_rls_owner;
revoke all on function public.rotate_pilot_intake_token(uuid, text, text)
  from public, anon, service_role;
grant execute on function public.rotate_pilot_intake_token(uuid, text, text) to authenticated;

drop function if exists public.rotate_pilot_intake_token(uuid, text);

-- --------------------------------------------------------------------------
-- D5: create_pilot_intake_upload with a per token+IP hourly mint rate limit.
-- --------------------------------------------------------------------------
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
  v_rate_window timestamptz;
  v_rate_count integer;
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

  -- Per token+IP hourly cap on signed-upload minting (security.md §12: public
  -- photo upload init 10/IP/hour). Counted before inserting the reservation so a
  -- link holder cannot mint unlimited signed PUT URLs.
  v_rate_window := date_bin(
    interval '1 hour', statement_timestamp(), timestamptz '2001-01-01 00:00:00+00'
  );
  insert into private.pilot_intake_rate_limits (
    organization_id, token_id, ip_hash, action, window_started_at, request_count
  ) values (
    v_token.organization_id, v_token.id, v_ip_hash, 'upload', v_rate_window, 1
  )
  on conflict (token_id, ip_hash, action, window_started_at)
  do update set request_count = private.pilot_intake_rate_limits.request_count + 1,
                updated_at = clock_timestamp()
  returning request_count into v_rate_count;
  if v_rate_count > 10 then
    raise exception using errcode = 'P0001', message = 'PILOT_RATE_LIMITED';
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
