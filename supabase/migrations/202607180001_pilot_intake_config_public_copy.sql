-- Repair the TS<->SQL contract for the public intake configuration. The public
-- form needs the merchant-facing display copy (name, headline, privacy notice)
-- that owners edit through update_pilot_organization_settings, not just the raw
-- organization/service-catalog rows. This CREATE OR REPLACE keeps the existing
-- grants and the sanitization guarantees (no token, hash, cost or phone data
-- leaves the boundary) while surfacing the allowlisted display copy with the
-- same safe defaults the settings RPCs already use.

create or replace function public.resolve_pilot_intake_config(
  p_public_intake_token_hash_hex text
)
returns jsonb
language plpgsql
-- Deliberately volatile: require_pilot_intake_token takes a FOR SHARE row lock,
-- which PostgREST cannot run inside the read-only transaction a STABLE function
-- is given. Volatile keeps the service-role API call in a read-write
-- transaction so the capability lookup succeeds.
volatile
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_token public.public_access_tokens%rowtype;
  v_org public.organizations%rowtype;
  v_items jsonb;
  v_headline text;
  v_privacy text;
begin
  v_token := private.require_pilot_intake_token(
    p_public_intake_token_hash_hex, 'intake:create'
  );

  select * into strict v_org from public.organizations where id = v_token.organization_id;
  if coalesce((v_org.settings ->> 'intakeEnabled')::boolean, true) is false then
    raise exception using errcode = '42501', message = 'PILOT_PUBLIC_LINK_NOT_FOUND';
  end if;

  v_headline := coalesce(
    nullif(v_org.settings ->> 'intakeHeadline', ''),
    '告訴我們需要協助的工程服務'
  );
  v_privacy := coalesce(
    nullif(v_org.settings ->> 'privacyNotice', ''),
    '送出即表示您同意店家為聯絡、報價與派工目的使用本次提供的資料。'
  );

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
    'merchantName', v_org.name,
    'headline', v_headline,
    'privacyNotice', v_privacy,
    'serviceCatalogItems', v_items
  );
end;
$$;

alter function public.resolve_pilot_intake_config(text) owner to renoly_rls_owner;
revoke all on function public.resolve_pilot_intake_config(text)
  from public, anon, authenticated;
grant execute on function public.resolve_pilot_intake_config(text) to service_role;

-- Same read-only-transaction fix for the upload verification lookup: it also
-- calls require_pilot_intake_token (FOR SHARE), so it must run volatile to be
-- callable through PostgREST by the trusted service-role API. Body is otherwise
-- identical to the 0005 definition.
create or replace function public.get_pilot_intake_upload_verification(
  p_public_intake_token_hash_hex text,
  p_intake_id uuid,
  p_upload_id uuid
)
returns jsonb
language plpgsql
volatile
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
