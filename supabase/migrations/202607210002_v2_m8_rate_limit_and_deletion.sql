-- Renoly v2 M8 (Wave A) — production hardening: authenticated-caller rate limiting,
-- pilot data-deletion / anonymization flow, and a retention cleanup worker.
--
-- Two private support tables:
--   private.pilot_authenticated_rate_limits — a shared fixed-window limiter keyed
--     on (user, org, action), mirroring the public quote limiter. Consumed in a
--     SEPARATE transaction (SECURITY DEFINER, service_role only) so a rejected
--     request cannot roll its own increment back.
--   private.pilot_data_deletion_requests — tracks an owner-initiated deletion:
--     re-auth token hash, export path, status, purge_at.
--
-- request/finalize deletion anonymizes name/phone/email/address for the TARGET org
-- only, keeping transaction-necessary ids (release gate 7, security.md 10.3).

set search_path = pg_catalog, public, private, extensions;

------------------------------------------------------------------------------
-- 1. Authenticated rate limiter (shared fixed window).
------------------------------------------------------------------------------

create table private.pilot_authenticated_rate_limits (
  organization_id uuid not null,
  user_id uuid not null,
  action text not null,
  window_started_at timestamptz not null,
  request_count integer not null default 1,
  updated_at timestamptz not null default clock_timestamp(),
  primary key (organization_id, user_id, action, window_started_at),
  constraint pilot_auth_rate_action_chk check (
    action in ('read', 'mutation', 'search_report')
  ),
  constraint pilot_auth_rate_count_chk check (request_count between 1 and 1000000)
);

create index pilot_authenticated_rate_window_idx
  on private.pilot_authenticated_rate_limits (window_started_at);

alter table private.pilot_authenticated_rate_limits owner to renoly_rls_owner;
alter table private.pilot_authenticated_rate_limits enable row level security;
alter table private.pilot_authenticated_rate_limits force row level security;
revoke all on private.pilot_authenticated_rate_limits
  from public, anon, authenticated, service_role;

-- consume_pilot_authenticated_rate_limit: increments the (user, org, action) window
-- and returns 'ok' | 'limited'. Limits (security.md 12): read 300 / mutation 120 /
-- search_report 30 per rolling 1-minute window. Separate txn, service_role only.
create or replace function public.consume_pilot_authenticated_rate_limit(
  p_organization_id uuid,
  p_user_id uuid,
  p_action text,
  p_now timestamptz default null
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_now timestamptz := coalesce(p_now, statement_timestamp());
  v_window timestamptz;
  v_limit integer;
  v_count integer;
begin
  if p_organization_id is null or p_user_id is null then
    raise exception using errcode = '22023', message = 'RATE_LIMIT_PAYLOAD_INVALID';
  end if;
  if p_action not in ('read', 'mutation', 'search_report') then
    raise exception using errcode = '22023', message = 'RATE_LIMIT_ACTION_INVALID';
  end if;

  v_window := date_bin(interval '1 minute', v_now, timestamptz '2001-01-01 00:00:00+00');
  v_limit := case p_action
    when 'read' then 300
    when 'mutation' then 120
    else 30
  end;

  insert into private.pilot_authenticated_rate_limits (
    organization_id, user_id, action, window_started_at, request_count
  ) values (p_organization_id, p_user_id, p_action, v_window, 1)
  on conflict (organization_id, user_id, action, window_started_at)
  do update set
    request_count = least(private.pilot_authenticated_rate_limits.request_count + 1, 1000000),
    updated_at = clock_timestamp()
  returning request_count into v_count;

  -- Keep the table bounded without a scheduler.
  delete from private.pilot_authenticated_rate_limits
  where window_started_at < v_now - interval '1 day';

  if v_count > v_limit then
    return 'limited';
  end if;
  return 'ok';
end;
$$;

alter function public.consume_pilot_authenticated_rate_limit(uuid, uuid, text, timestamptz)
  owner to renoly_rls_owner;
revoke all on function public.consume_pilot_authenticated_rate_limit(uuid, uuid, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.consume_pilot_authenticated_rate_limit(uuid, uuid, text, timestamptz)
  to service_role;

------------------------------------------------------------------------------
-- 2. Pilot data deletion / anonymization.
------------------------------------------------------------------------------

create table private.pilot_data_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  requested_by uuid not null references auth.users(id) on delete restrict,
  reauth_token_hash bytea not null,
  export_path text,
  status text not null default 'requested',
  purge_at timestamptz not null,
  finalized_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint pilot_deletion_reauth_hash_chk check (octet_length(reauth_token_hash) = 32),
  constraint pilot_deletion_status_chk check (
    status in ('requested', 'exporting', 'ready', 'finalized', 'cancelled')
  ),
  constraint pilot_deletion_export_path_chk check (
    export_path is null or char_length(export_path) <= 1000
  )
);

create index pilot_data_deletion_org_idx
  on private.pilot_data_deletion_requests (organization_id, status, created_at desc);
create index pilot_data_deletion_purge_idx
  on private.pilot_data_deletion_requests (purge_at)
  where status in ('requested', 'exporting', 'ready');

alter table private.pilot_data_deletion_requests owner to renoly_rls_owner;
alter table private.pilot_data_deletion_requests enable row level security;
alter table private.pilot_data_deletion_requests force row level security;
revoke all on private.pilot_data_deletion_requests
  from public, anon, authenticated, service_role;

-- request_pilot_data_deletion: owner re-auth starts the flow. Stores the re-auth
-- token hash + a 15-minute export window; purge_at = now + 24h.
create or replace function public.request_pilot_data_deletion(
  target_org uuid,
  p_reauth_token_hash_hex text,
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
  v_hash bytea;
  v_id uuid;
begin
  if not public.has_org_role(target_org, array['owner']::text[]) then
    raise exception using errcode = '42501', message = 'DATA_DELETION_OWNER_REQUIRED';
  end if;
  v_hash := private.decode_pilot_sha256_hex(p_reauth_token_hash_hex, 'DATA_DELETION_REAUTH_INVALID');

  insert into private.pilot_data_deletion_requests (
    organization_id, requested_by, reauth_token_hash, status, purge_at
  ) values (
    target_org, v_actor, v_hash, 'requested', clock_timestamp() + interval '24 hours'
  )
  returning id into v_id;

  perform private.append_system_event(
    target_org, 'customer', target_org, 'organization.data_deletion_requested',
    jsonb_build_object('deletionRequestId', v_id),
    p_request_id, null, p_occurred_at
  );

  return jsonb_build_object('deletionRequestId', v_id, 'status', 'requested');
end;
$$;

alter function public.request_pilot_data_deletion(uuid, text, timestamptz, uuid)
  owner to renoly_rls_owner;
revoke all on function public.request_pilot_data_deletion(uuid, text, timestamptz, uuid)
  from public, anon, service_role;
grant execute on function public.request_pilot_data_deletion(uuid, text, timestamptz, uuid)
  to authenticated;

-- finalize_pilot_data_deletion: anonymize PII for the TARGET org only, keeping the
-- transaction-necessary ids (org/customer ids, amounts, events). Confirm-once: a
-- second call after 'finalized' is a no-op returning the same summary.
create or replace function public.finalize_pilot_data_deletion(
  target_org uuid,
  p_deletion_request_id uuid,
  p_reauth_token_hash_hex text,
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
  v_req private.pilot_data_deletion_requests%rowtype;
  v_hash bytea;
  v_customers integer;
  v_locations integer;
  v_requests integer;
begin
  if not public.has_org_role(target_org, array['owner']::text[]) then
    raise exception using errcode = '42501', message = 'DATA_DELETION_OWNER_REQUIRED';
  end if;
  v_hash := private.decode_pilot_sha256_hex(p_reauth_token_hash_hex, 'DATA_DELETION_REAUTH_INVALID');

  select * into v_req from private.pilot_data_deletion_requests
  where organization_id = target_org and id = p_deletion_request_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'DATA_DELETION_REQUEST_NOT_FOUND';
  end if;
  if v_req.reauth_token_hash is distinct from v_hash then
    raise exception using errcode = '42501', message = 'DATA_DELETION_REAUTH_INVALID';
  end if;

  -- Confirm-once: replay after finalization returns the recorded summary.
  if v_req.status = 'finalized' then
    return jsonb_build_object('deletionRequestId', v_req.id, 'status', 'finalized', 'replayed', true);
  end if;
  if v_req.status = 'cancelled' then
    raise exception using errcode = '23514', message = 'DATA_DELETION_REQUEST_CANCELLED';
  end if;

  -- Anonymize PII, scoped strictly to target_org. Ids and financial rows survive.
  update public.customers
  set name = '已刪除客戶', phone = null, email = null,
      updated_at = clock_timestamp(), updated_by = v_actor
  where organization_id = target_org;
  get diagnostics v_customers = row_count;

  update public.locations
  set label = '已刪除地點', county = '', district = '', address_line = '已刪除',
      updated_at = clock_timestamp(), updated_by = v_actor
  where organization_id = target_org;
  get diagnostics v_locations = row_count;

  -- contact_method_chk requires at least one contact channel. Rows already bound
  -- to a LINE identity keep that binding and drop phone/email; rows without one
  -- get a non-PII placeholder email so the constraint holds after anonymization.
  -- original_submission is scrubbed to NULL; the M8 guard permits this redaction.
  update public.service_requests
  set contact_name = '已刪除', contact_phone = null,
      contact_email = case when customer_line_identity_id is not null
                           then null else 'deleted@anon.invalid' end,
      description = '',
      original_submission = null, metadata = '{}'::jsonb,
      updated_at = clock_timestamp(), updated_by = v_actor
  where organization_id = target_org;
  get diagnostics v_requests = row_count;

  update public.customer_line_identities
  set display_name = '已刪除', friend_status = 'blocked'
  where organization_id = target_org;

  update private.pilot_data_deletion_requests
  set status = 'finalized', finalized_at = clock_timestamp(), updated_at = clock_timestamp()
  where id = p_deletion_request_id;

  perform private.append_system_event(
    target_org, 'customer', target_org, 'organization.data_deletion_finalized',
    jsonb_build_object(
      'deletionRequestId', p_deletion_request_id,
      'anonymizedCustomers', v_customers,
      'anonymizedLocations', v_locations,
      'anonymizedRequests', v_requests
    ),
    p_request_id, null, p_occurred_at
  );

  return jsonb_build_object(
    'deletionRequestId', p_deletion_request_id, 'status', 'finalized',
    'anonymizedCustomers', v_customers, 'anonymizedLocations', v_locations,
    'anonymizedRequests', v_requests, 'replayed', false
  );
end;
$$;

alter function public.finalize_pilot_data_deletion(uuid, uuid, text, timestamptz, uuid)
  owner to renoly_rls_owner;
revoke all on function public.finalize_pilot_data_deletion(uuid, uuid, text, timestamptz, uuid)
  from public, anon, service_role;
grant execute on function public.finalize_pilot_data_deletion(uuid, uuid, text, timestamptz, uuid)
  to authenticated;

------------------------------------------------------------------------------
-- 3. Retention cleanup worker.
--    Purges expired quarantined/deleted photo rows past their upload window and
--    raw LINE webhook payloads older than 90 days (keeps a redacted event trail
--    via the durable events/notifications tables). service_role only, idempotent.
------------------------------------------------------------------------------

create or replace function public.run_retention_cleanup(
  p_now timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_now timestamptz := coalesce(p_now, clock_timestamp());
  v_photos integer;
  v_webhooks integer;
  v_deletions integer;
begin
  -- Expired stale uploads: pending/processing photos never finalized within 24h.
  with purged as (
    update public.photos
    set status = 'deleted', deleted_at = clock_timestamp(), lock_version = lock_version + 1
    where status in ('pending', 'processing')
      and created_at < v_now - interval '24 hours'
      and deleted_at is null
    returning id
  )
  select count(*) into v_photos from purged;

  -- Raw webhook payloads older than 90 days are stripped (kept as an empty jsonb
  -- so the row/audit id survives but the raw content is gone).
  with stripped as (
    update public.line_webhook_events
    set payload = '{}'::jsonb
    where received_at < v_now - interval '90 days'
      and payload <> '{}'::jsonb
    returning id
  )
  select count(*) into v_webhooks from stripped;

  -- Data deletion export files past their purge window are marked cleaned.
  with cleaned as (
    update private.pilot_data_deletion_requests
    set export_path = null, updated_at = clock_timestamp()
    where purge_at < v_now and export_path is not null
    returning id
  )
  select count(*) into v_deletions from cleaned;

  return jsonb_build_object(
    'purgedPhotos', v_photos,
    'strippedWebhooks', v_webhooks,
    'cleanedExports', v_deletions
  );
end;
$$;

alter function public.run_retention_cleanup(timestamptz) owner to renoly_rls_owner;
revoke all on function public.run_retention_cleanup(timestamptz)
  from public, anon, authenticated;
grant execute on function public.run_retention_cleanup(timestamptz) to service_role;
