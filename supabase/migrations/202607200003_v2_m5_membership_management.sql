-- Renoly v2 M5 membership management.
--
-- Two manager-gated RPCs backing the pilot "team" screen:
--
--   * public.list_pilot_members(uuid) — the full-roster projection. Unlike
--     public.list_pilot_assignable_members (which the assignment picker depends
--     on and which stays active-only), this returns EVERY member except the
--     tombstoned ('removed') ones, so invited/suspended members are visible in
--     the roster. Technician-first, then by display_name.
--
--   * public.invite_pilot_member(...) — an owner/dispatcher/admin adds a staff
--     member (technician/dispatcher/admin only — never a second owner; the
--     single-owner invariant is enforced by private.guard_membership_owner) to
--     their OWN organization. The auth user is provisioned by the route layer via
--     the admin API BEFORE this runs; here we only bind that user id to a new
--     active membership. Idempotent replay is modelled on
--     public.create_pilot_organization.
--
-- Conventions match the rest of the pilot RPC surface: security definer, a fixed
-- search_path, owner renoly_rls_owner, revoke-all + grant-execute-to-authenticated.

------------------------------------------------------------------------------
-- Full-roster projection (invited + active + suspended; never 'removed')
------------------------------------------------------------------------------

create or replace function public.list_pilot_members(
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
    and m.status <> 'removed';

  return result_json;
end;
$$;

alter function public.list_pilot_members(uuid) owner to renoly_rls_owner;
revoke all on function public.list_pilot_members(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.list_pilot_members(uuid)
  to authenticated;

------------------------------------------------------------------------------
-- Invite / add an operational member to the caller's own organization
------------------------------------------------------------------------------

create or replace function public.invite_pilot_member(
  p_organization_id uuid,
  p_user_id uuid,
  p_display_name text,
  p_role text,
  p_phone text default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, extensions
as $$
declare
  v_actor uuid;
  v_membership_id uuid := gen_random_uuid();
  v_display_name text := btrim(coalesce(p_display_name, ''));
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
  v_actor_fingerprint text;
  v_request_hash text;
  v_idempotency public.idempotency_keys%rowtype;
  v_inserted integer;
  v_response jsonb;
begin
  -- Manager gate first: also raises AUTH_REQUIRED / FORBIDDEN and, for a
  -- cross-tenant caller, FORBIDDEN (no active manager membership in target org).
  v_actor := private.require_pilot_manager(p_organization_id);

  if p_user_id is null then
    raise exception using errcode = '22023', message = 'PILOT_VALIDATION_FAILED';
  end if;
  if v_display_name = '' or char_length(v_display_name) > 80 then
    raise exception using errcode = '22023', message = 'PILOT_VALIDATION_FAILED';
  end if;
  if p_role not in ('admin', 'dispatcher', 'technician') then
    -- 'owner' (and anything else) is rejected here; the single-owner invariant
    -- is additionally protected by private.guard_membership_owner.
    raise exception using errcode = '22023', message = 'PILOT_INVALID_ROLE';
  end if;
  if v_phone is not null and v_phone !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception using errcode = '22023', message = 'PILOT_VALIDATION_FAILED';
  end if;
  if nullif(btrim(coalesce(p_idempotency_key, '')), '') is null
     or char_length(p_idempotency_key) not between 8 and 200 then
    raise exception using errcode = '22023', message = 'PILOT_VALIDATION_FAILED';
  end if;

  -- Idempotency guard: fingerprint by actor + operation, request hash binds the
  -- canonical business inputs so a genuine retry replays the first response.
  v_actor_fingerprint := 'pilot-member:' || v_actor::text;
  v_request_hash := encode(
    extensions.digest(
      p_organization_id::text || '|' || p_user_id::text || '|' || v_display_name
        || '|' || p_role || '|' || coalesce(v_phone, ''),
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
    '/api/v2/organizations/{orgId}/members',
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
      and path_template = '/api/v2/organizations/{orgId}/members'
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

  -- Reject a re-invite of a user who already has ANY membership in this org
  -- (active/invited/suspended/removed). Deliberately checked before the insert so
  -- the caller gets a stable MEMBERSHIP_ALREADY_EXISTS rather than a raw
  -- unique_violation on (organization_id, user_id).
  if exists (
    select 1 from public.memberships m
    where m.organization_id = p_organization_id
      and m.user_id = p_user_id
  ) then
    raise exception using errcode = '23505', message = 'MEMBERSHIP_ALREADY_EXISTS';
  end if;

  insert into public.memberships (
    id, organization_id, user_id, role, status, display_name, phone,
    invited_by, invited_at, joined_at, created_by, updated_by
  ) values (
    v_membership_id, p_organization_id, p_user_id, p_role, 'active', v_display_name,
    v_phone, v_actor, clock_timestamp(), clock_timestamp(), v_actor, v_actor
  );

  v_response := jsonb_build_object(
    'id', v_membership_id,
    'display_name', v_display_name,
    'role', p_role,
    'status', 'active'
  );

  update public.idempotency_keys
  set state = 'completed', response_status = 201, response_body = v_response,
      resource_type = 'membership', resource_id = v_membership_id,
      locked_until = null, updated_at = clock_timestamp()
  where id = v_idempotency.id;

  return v_response;
exception
  when unique_violation then
    -- A concurrent invite of the same user races past the pre-check.
    raise exception using errcode = '23505', message = 'MEMBERSHIP_ALREADY_EXISTS';
end;
$$;

alter function public.invite_pilot_member(uuid, uuid, text, text, text, text)
  owner to renoly_rls_owner;
revoke all on function public.invite_pilot_member(uuid, uuid, text, text, text, text)
  from public, anon, service_role;
grant execute on function public.invite_pilot_member(uuid, uuid, text, text, text, text)
  to authenticated;
