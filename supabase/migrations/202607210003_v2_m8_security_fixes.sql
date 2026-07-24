-- Renoly v2 M8 — security fixes (Wave A follow-up).
--
-- FIX 1 (HIGH): finalize_pilot_data_deletion under-deleted location PII. The
--   locations UPDATE anonymized label/county/district/address_line but left
--   contact_name, contact_phone, latitude, longitude and access_notes intact —
--   a promised irreversible deletion still exposed the on-site contact name +
--   phone, exact geocoordinates and the door/access code. The UPDATE now also
--   scrubs those columns (contact_name mirrors service_requests.contact_name,
--   access_notes is NOT NULL default '' so it is set to '' rather than null).
--
-- FIX 2 (medium): private.pilot_screen_payment_sensitive used jsonb_each_text,
--   which only expands TOP-LEVEL keys. A nested {"note":{"card":"4111..."}} or an
--   array value slipped past the screen and mark-paid accepted it. The screen now
--   walks the payload recursively (every object key and every scalar leaf at every
--   depth) via jsonb_path_query(..., 'strict $.**'), applying the existing key
--   regex to every key and the digit heuristic to every string leaf.
--
-- Additive / replace-only. No schema changes; grants/owner/search_path preserved.

set search_path = pg_catalog, public, private, extensions;

------------------------------------------------------------------------------
-- FIX 2. Recursive sensitive-payment screen.
------------------------------------------------------------------------------
create or replace function private.pilot_screen_payment_sensitive(p_payload jsonb)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  v_key text;
  v_val text;
  v_digits text;
  v_node jsonb;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    return false;
  end if;

  -- Walk every object key at every depth. strict $.** visits every node; the
  -- ?(@.type()=="object") filter keeps object nodes (whether nested under objects
  -- or arrays), and .keyvalue() then yields each key on those nodes as a
  -- {"key":..,"value":..,"id":..} triple. Filtering avoids the strict-mode error
  -- that .keyvalue() raises on scalar/array nodes.
  for v_key in
    select kv ->> 'key'
    from jsonb_path_query(p_payload, 'strict $.**?(@.type() == "object").keyvalue()') as kv
  loop
    if lower(v_key) ~ '(card|cvv|cvc|pan|iban|routing|account_number|bank_secret|security_code|expiry|exp_month|exp_year)' then
      return true;
    end if;
  end loop;

  -- Walk every node at every depth and inspect each scalar leaf's text form for a
  -- PAN-shaped run of 13-19 contiguous digits (ignoring spaces/dashes). Objects
  -- and arrays have no scalar text (jsonb_typeof filters them out); numbers and
  -- strings are both checked as their text representation.
  for v_node in
    select value
    from jsonb_path_query(p_payload, 'strict $.**') as t(value)
  loop
    if jsonb_typeof(v_node) in ('string', 'number') then
      v_val := case
        when jsonb_typeof(v_node) = 'string' then v_node #>> '{}'
        else v_node::text
      end;
      v_digits := regexp_replace(coalesce(v_val, ''), '[\s\-]', '', 'g');
      if v_digits ~ '^\d{13,19}$' then
        return true;
      end if;
    end if;
  end loop;

  -- bare 3-4 digit CVV supplied under a numeric-looking value is allowed
  -- (amounts), but a value labelled cvv already caught above.
  return false;
end;
$$;

alter function private.pilot_screen_payment_sensitive(jsonb) owner to renoly_rls_owner;
revoke all on function private.pilot_screen_payment_sensitive(jsonb)
  from public, anon, authenticated, service_role;

------------------------------------------------------------------------------
-- FIX 1. finalize_pilot_data_deletion — extend locations scrub to the remaining
--        PII columns (contact_name/contact_phone/latitude/longitude/access_notes).
--        Body reproduced verbatim except for that UPDATE.
------------------------------------------------------------------------------
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

  -- Scrub ALL location PII: label/county/district/address_line plus the on-site
  -- contact name+phone, exact geocoordinates and door/access code. contact_name
  -- mirrors the service_requests scrub value; access_notes is NOT NULL default ''
  -- so it is emptied rather than nulled.
  update public.locations
  set label = '已刪除地點', county = '', district = '', address_line = '已刪除',
      contact_name = '已刪除', contact_phone = null,
      latitude = null, longitude = null, access_notes = '',
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
