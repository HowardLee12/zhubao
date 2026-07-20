-- Renoly v2 M7 fix — confirming an intake draft from an UNBOUND LINE sender.
--
-- Bug: confirm_intake_draft (202607200008) inserted a service_request with
-- customer_line_identity_id = NULL and no contact_phone/contact_email whenever
-- the conversation had never been bound to a customer LINE identity (the COMMON
-- case: a first-time LINE customer). That violated
-- service_requests_contact_method_chk (202607160001) → SQLSTATE 23514 with the
-- constraint name in the message, which mapIntakeDraftRpcError does NOT match,
-- so the staff confirm surfaced a raw 500. This defeats the M7 promise that a
-- manual/degraded draft is ALWAYS confirmable.
--
-- Root constraint: customer_line_identities.customer_id is NOT NULL — a bare
-- identity cannot exist. So the fix mirrors M3 convert: at confirm time, when
-- the conversation carries no bound identity, RESOLVE-OR-CREATE a customer + a
-- customer_line_identity from the conversation's (org, line_channel_id,
-- line_user_id), bind the conversation to it going forward, and use that
-- identity on the service_request. contact_method_chk is then always satisfied.
--
-- This migration CREATE OR REPLACEs confirm_intake_draft, reproducing its prior
-- body verbatim except for the resolve-or-create block inserted just before the
-- service_requests INSERT. All grants / owner / search_path / confirm-once
-- idempotency / event append are preserved unchanged.

set search_path = pg_catalog, public, private, extensions;

create or replace function public.confirm_intake_draft(
  target_org uuid,
  target_draft uuid,
  expected_lock_version integer,
  target_idempotency_key text default null,
  p_field_overrides jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_draft public.intake_drafts%rowtype;
  v_conversation public.conversations%rowtype;
  v_existing_sr public.service_requests%rowtype;
  v_service_request_id uuid := gen_random_uuid();
  v_source_reference text;
  v_period_key text;
  v_org_timezone text;
  v_request_sequence bigint;
  v_request_no text;
  v_contact_name text;
  v_subject text;
  v_description text;
  v_customer_line_identity_id uuid;
  v_customer_id uuid;
  v_customer_sequence bigint;
  v_customer_no text;
  v_original_submission jsonb;
  v_fields jsonb;
  v_now timestamptz := statement_timestamp();
begin
  if not public.has_org_role(target_org, array['owner', 'admin', 'dispatcher']::text[]) then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;

  select * into v_draft
  from public.intake_drafts
  where organization_id = target_org and id = target_draft
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'INTAKE_DRAFT_NOT_FOUND';
  end if;

  v_source_reference := v_draft.conversation_id::text;

  -- confirm-once: an already-confirmed draft (or a replay hitting the
  -- service_requests source-reference unique) returns the existing request.
  if v_draft.status = 'confirmed' and v_draft.converted_service_request_id is not null then
    select * into v_existing_sr
    from public.service_requests
    where organization_id = target_org and id = v_draft.converted_service_request_id;
    return jsonb_build_object(
      'serviceRequestId', v_existing_sr.id,
      'requestNo', v_existing_sr.request_no,
      'draftId', v_draft.id,
      'draftStatus', v_draft.status,
      'status', v_existing_sr.status,
      'replayed', true
    );
  end if;

  if v_draft.status <> 'pending_review' then
    raise exception using errcode = '23514', message = 'INTAKE_DRAFT_NOT_CONFIRMABLE';
  end if;
  if v_draft.lock_version is distinct from expected_lock_version then
    raise exception using errcode = '40001', message = 'STALE_VERSION';
  end if;

  -- A prior confirm on THIS conversation already created the request; return it
  -- (idempotent even if this draft row is a different generation).
  select * into v_existing_sr
  from public.service_requests
  where organization_id = target_org and source = 'line' and source_reference = v_source_reference;
  if found then
    update public.intake_drafts
    set status = 'confirmed',
        converted_service_request_id = v_existing_sr.id,
        updated_at = clock_timestamp(),
        lock_version = lock_version + 1
    where id = v_draft.id;
    return jsonb_build_object(
      'serviceRequestId', v_existing_sr.id,
      'requestNo', v_existing_sr.request_no,
      'draftId', v_draft.id,
      'draftStatus', 'confirmed',
      'status', v_existing_sr.status,
      'replayed', true
    );
  end if;

  select * into v_conversation
  from public.conversations
  where organization_id = target_org and id = v_draft.conversation_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'CONVERSATION_NOT_FOUND';
  end if;

  v_fields := coalesce(p_field_overrides, v_draft.fields, '{}'::jsonb);
  v_customer_line_identity_id := v_conversation.customer_line_identity_id;

  -- Resolve the contact/subject/description from field overrides, then the draft
  -- fields' per-field { value } shape, then safe fallbacks so a manual (degraded)
  -- draft with empty fields still yields a valid service_request.
  v_contact_name := coalesce(
    nullif(btrim(v_fields #>> '{contactName,value}'), ''),
    nullif(btrim(v_fields ->> 'contactName'), ''),
    'LINE 客戶'
  );
  v_subject := coalesce(
    nullif(btrim(v_fields #>> '{subject,value}'), ''),
    nullif(btrim(v_fields ->> 'subject'), ''),
    nullif(btrim(v_draft.title), ''),
    'LINE 訊息進件'
  );
  v_description := coalesce(
    nullif(btrim(v_fields #>> '{description,value}'), ''),
    nullif(btrim(v_fields ->> 'description'), ''),
    nullif(btrim(v_draft.summary), ''),
    ''
  );

  -- Resolve-or-create the customer LINE identity when the conversation was never
  -- bound (the common first-time-sender case). Without this, an unbound sender's
  -- service_request would carry no contact method at all and violate
  -- service_requests_contact_method_chk. Mirrors M3 convert's customer creation:
  -- a customer_no via next_document_number, source='line'.
  if v_customer_line_identity_id is null then
    -- (1) An identity for this (org, channel, user) may already exist even though
    -- the conversation was never linked to it. Reuse it.
    select id, customer_id into v_customer_line_identity_id, v_customer_id
    from public.customer_line_identities
    where organization_id = target_org
      and line_channel_id = v_conversation.line_channel_id
      and line_user_id = v_conversation.line_user_id;

    if v_customer_line_identity_id is null then
      -- (2) None exists: create a customer, then the identity. customer_id is
      -- NOT NULL on customer_line_identities, so the customer must come first.
      select coalesce(timezone, 'Asia/Taipei') into v_org_timezone
      from public.organizations where id = target_org;
      v_customer_sequence := public.next_document_number(
        target_org, 'customer',
        to_char((v_now at time zone coalesce(v_org_timezone, 'Asia/Taipei')), 'YYYYMM')
      );
      v_customer_no := 'CU-'
        || to_char((v_now at time zone coalesce(v_org_timezone, 'Asia/Taipei')), 'YYYYMM')
        || '-' || lpad(v_customer_sequence::text, 6, '0');
      v_customer_id := gen_random_uuid();

      insert into public.customers (
        id, organization_id, customer_no, kind, name, source, last_contact_at,
        created_by, updated_by
      ) values (
        v_customer_id, target_org, v_customer_no, 'individual',
        left(coalesce(nullif(btrim(v_contact_name), ''), v_conversation.line_user_id), 120),
        'line', v_now,
        (select private.current_actor_user_id()), (select private.current_actor_user_id())
      );

      -- The (line_channel_id, line_user_id) unique may race with a concurrent
      -- confirm/ingest; on conflict, re-select the winning identity.
      insert into public.customer_line_identities (
        organization_id, customer_id, line_channel_id, line_user_id, friend_status
      ) values (
        target_org, v_customer_id, v_conversation.line_channel_id,
        v_conversation.line_user_id, 'unknown'
      )
      on conflict (line_channel_id, line_user_id) do nothing
      returning id into v_customer_line_identity_id;

      if v_customer_line_identity_id is null then
        select id, customer_id into v_customer_line_identity_id, v_customer_id
        from public.customer_line_identities
        where organization_id = target_org
          and line_channel_id = v_conversation.line_channel_id
          and line_user_id = v_conversation.line_user_id;
      end if;
    end if;

    -- (3) Bind the conversation to the resolved identity so it stays bound.
    update public.conversations
    set customer_line_identity_id = v_customer_line_identity_id,
        updated_at = clock_timestamp(),
        lock_version = lock_version + 1
    where organization_id = target_org and id = v_conversation.id;
  end if;

  -- Immutable snapshot: the message-derived draft as it stood at confirm time.
  v_original_submission := jsonb_build_object(
    'source', 'line',
    'conversationId', v_conversation.id,
    'lineUserId', v_conversation.line_user_id,
    'origin', v_draft.origin,
    'summary', v_draft.summary,
    'title', v_draft.title,
    'fields', v_fields,
    'missingFields', to_jsonb(v_draft.missing_fields),
    'confidence', v_draft.confidence,
    'confirmedAt', v_now
  );

  select coalesce(timezone, 'Asia/Taipei') into v_org_timezone
  from public.organizations where id = target_org;
  v_period_key := to_char((v_now at time zone coalesce(v_org_timezone, 'Asia/Taipei')), 'YYYYMM');

  insert into public.document_sequences (organization_id, document_type, period_key, current_value)
  values (target_org, 'request', v_period_key, 1)
  on conflict (organization_id, document_type, period_key)
  do update set current_value = public.document_sequences.current_value + 1,
                updated_at = statement_timestamp()
  returning current_value into v_request_sequence;
  v_request_no := 'SR-' || v_period_key || '-' || lpad(v_request_sequence::text, 6, '0');

  insert into public.service_requests (
    id, organization_id, request_no, source, source_reference,
    contact_name, customer_line_identity_id, subject, description,
    priority, status, original_submission, metadata
  ) values (
    v_service_request_id, target_org, v_request_no, 'line', v_source_reference,
    v_contact_name, v_customer_line_identity_id, v_subject, v_description,
    'normal', 'new', v_original_submission,
    jsonb_build_object(
      'conversationId', v_conversation.id,
      'intakeDraftId', v_draft.id,
      'draftOrigin', v_draft.origin
    )
  );

  update public.intake_drafts
  set status = 'confirmed',
      converted_service_request_id = v_service_request_id,
      updated_at = clock_timestamp(),
      lock_version = lock_version + 1
  where id = v_draft.id;

  update public.conversations
  set status = 'drafted', updated_at = clock_timestamp(), lock_version = lock_version + 1
  where id = v_conversation.id;

  perform private.append_user_event(
    target_org, 'intake_draft', v_draft.id, 'intake_draft.confirmed',
    jsonb_build_object(
      'serviceRequestId', v_service_request_id,
      'requestNo', v_request_no,
      'conversationId', v_conversation.id,
      'draftOrigin', v_draft.origin
    ),
    null, target_idempotency_key, null
  );

  return jsonb_build_object(
    'serviceRequestId', v_service_request_id,
    'requestNo', v_request_no,
    'draftId', v_draft.id,
    'draftStatus', 'confirmed',
    'status', 'new',
    'replayed', false
  );
end;
$$;

alter function public.confirm_intake_draft(uuid, uuid, integer, text, jsonb)
  owner to renoly_rls_owner;
revoke all on function public.confirm_intake_draft(uuid, uuid, integer, text, jsonb)
  from public, anon, service_role;
grant execute on function public.confirm_intake_draft(uuid, uuid, integer, text, jsonb) to authenticated;
