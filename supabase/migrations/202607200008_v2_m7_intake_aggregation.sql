-- Renoly v2 M7 — free-form LINE message aggregation into human-confirmed intake
-- drafts, with an AI-extractor seam whose failure NEVER blocks intake.
--
-- Five new tables land inbound LINE messages, aggregate consecutive messages
-- from one sender into ONE open conversation, attach downloaded media, and hold
-- exactly one active "待確認進件草稿" (intake_draft) per conversation. An
-- append-only intake_extraction_runs table audits every AI attempt.
--
-- Product rule (CLAUDE.md): AI only produces drafts. A human confirms every
-- conversion. There is NO auto-quote / auto-dispatch / auto-notify here.
--
-- Degradation gate (guaranteed at the DB layer): a FAILED extraction still
-- yields a manual draft. record_extraction_run(status='failed') writes both the
-- failed run AND an origin='manual' draft, so the inbound message is never lost.
--
-- Role boundary (mirrors M6):
--   * Worker RPCs (ingest_inbound_message, create_intake_draft,
--     record_extraction_run, claim_intake_extraction_runs, mark_extraction_*)
--     are security-definer and granted to service_role only.
--   * Staff RPCs (confirm_intake_draft, dismiss_intake_draft) are granted to
--     authenticated; the owner/admin/dispatcher gate is enforced INSIDE the
--     function via has_org_role, never by a hidden button.
--   * No base table carries direct mutation grants; authenticated may only
--     SELECT (RLS-scoped) for the staff inbox read path.
--
-- Conversation aggregation window (see ADR docs/adr/0002): one open conversation
-- per (org, channel, line_user_id) via a partial unique WHERE status='open'.
-- Consecutive messages coalesce into it. On confirm/dismiss the conversation
-- leaves 'open' and a later message starts a fresh conversation.

set search_path = pg_catalog, public, private, extensions;

------------------------------------------------------------------------------
-- 1. Tables
------------------------------------------------------------------------------

-- conversations — aggregate root. One open row per sender (partial unique).
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  line_channel_id uuid not null,
  customer_line_identity_id uuid,
  line_user_id text not null,
  status text not null default 'open',
  last_message_at timestamptz,
  message_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  lock_version integer not null default 1,
  constraint conversations_org_id_uidx unique (organization_id, id),
  constraint conversations_channel_fk foreign key (organization_id, line_channel_id)
    references public.line_channels (organization_id, id) on delete restrict,
  constraint conversations_identity_fk foreign key (organization_id, customer_line_identity_id)
    references public.customer_line_identities (organization_id, id) on delete restrict,
  constraint conversations_line_user_length_chk check (char_length(line_user_id) between 1 and 255),
  constraint conversations_status_chk check (status in ('open', 'drafted', 'converted', 'dismissed')),
  constraint conversations_message_count_chk check (message_count >= 0),
  constraint conversations_lock_version_chk check (lock_version > 0)
);

-- One open conversation per (org, channel, line_user_id): consecutive messages
-- from one sender aggregate rather than fanning out into many conversations.
create unique index conversations_one_open_per_sender_uidx
  on public.conversations (organization_id, line_channel_id, line_user_id)
  where status = 'open';
create index conversations_status_recent_idx
  on public.conversations (organization_id, status, last_message_at desc, id desc);

-- inbound_messages — append-only child. raw/text_content are write-once.
create table public.inbound_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  conversation_id uuid not null,
  line_channel_id uuid not null,
  line_webhook_event_id uuid,
  line_message_id text,
  message_type text not null,
  text_content text,
  raw jsonb not null,
  sent_at timestamptz,
  received_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint inbound_messages_org_id_uidx unique (organization_id, id),
  constraint inbound_messages_conversation_fk foreign key (organization_id, conversation_id)
    references public.conversations (organization_id, id) on delete restrict,
  constraint inbound_messages_channel_fk foreign key (organization_id, line_channel_id)
    references public.line_channels (organization_id, id) on delete restrict,
  constraint inbound_messages_webhook_event_fk foreign key (organization_id, line_webhook_event_id)
    references public.line_webhook_events (organization_id, id) on delete restrict,
  constraint inbound_messages_type_chk check (message_type in ('text', 'image', 'sticker', 'other')),
  constraint inbound_messages_text_length_chk check (text_content is null or char_length(text_content) <= 20000),
  constraint inbound_messages_line_message_id_length_chk check (
    line_message_id is null or char_length(line_message_id) between 1 and 120
  ),
  constraint inbound_messages_raw_size_chk check (octet_length(raw::text) <= 262144)
);

-- Dedup: the same LINE message id is landed at most once per channel.
create unique index inbound_messages_dedup_uidx
  on public.inbound_messages (organization_id, line_channel_id, line_message_id)
  where line_message_id is not null;
create index inbound_messages_conversation_idx
  on public.inbound_messages (organization_id, conversation_id, received_at, id);

-- message_attachments — downloaded LINE media (private bucket, signed URL only).
create table public.message_attachments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  inbound_message_id uuid not null,
  kind text not null default 'image',
  status text not null default 'pending',
  storage_bucket text not null default 'v2-intake-photos',
  storage_path text,
  thumbnail_path text,
  content_hash text,
  mime_type text,
  byte_size bigint,
  created_at timestamptz not null default now(),
  constraint message_attachments_org_id_uidx unique (organization_id, id),
  constraint message_attachments_message_fk foreign key (organization_id, inbound_message_id)
    references public.inbound_messages (organization_id, id) on delete restrict,
  constraint message_attachments_kind_chk check (kind in ('image')),
  constraint message_attachments_status_chk check (
    status in ('pending', 'processing', 'ready', 'quarantined', 'failed', 'deleted')
  ),
  constraint message_attachments_bucket_chk check (storage_bucket = 'v2-intake-photos'),
  constraint message_attachments_storage_path_chk check (
    storage_path is null or char_length(storage_path) between 1 and 1000
  ),
  constraint message_attachments_content_hash_chk check (
    content_hash is null or content_hash ~ '^[0-9a-f]{64}$'
  ),
  constraint message_attachments_mime_chk check (
    mime_type is null or mime_type in ('image/jpeg', 'image/png', 'image/webp')
  ),
  constraint message_attachments_byte_size_chk check (byte_size is null or byte_size between 1 and 10485760),
  constraint message_attachments_ready_shape_chk check (
    status <> 'ready'
    or (storage_path is not null and content_hash is not null and mime_type is not null and byte_size is not null)
  )
);

create unique index message_attachments_storage_path_uidx
  on public.message_attachments (storage_path) where storage_path is not null;
create index message_attachments_message_idx
  on public.message_attachments (organization_id, inbound_message_id, id);

-- intake_extraction_runs — append-only audit + extraction inbox.
create table public.intake_extraction_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  conversation_id uuid not null,
  intake_draft_id uuid,
  extractor_name text not null,
  model_version text,
  status text not null,
  confidence numeric(4,3),
  input_message_ids uuid[] not null default '{}'::uuid[],
  output jsonb,
  error_code text,
  latency_ms integer,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  constraint intake_extraction_runs_org_id_uidx unique (organization_id, id),
  constraint intake_extraction_runs_conversation_fk foreign key (organization_id, conversation_id)
    references public.conversations (organization_id, id) on delete restrict,
  constraint intake_extraction_runs_extractor_chk check (extractor_name in ('fake', 'fireworks')),
  constraint intake_extraction_runs_status_chk check (status in ('succeeded', 'failed', 'degraded')),
  constraint intake_extraction_runs_confidence_chk check (
    confidence is null or (confidence >= 0 and confidence <= 1)
  ),
  constraint intake_extraction_runs_error_code_chk check (
    error_code is null or char_length(error_code) between 1 and 120
  ),
  constraint intake_extraction_runs_latency_chk check (latency_ms is null or latency_ms >= 0),
  constraint intake_extraction_runs_output_size_chk check (output is null or octet_length(output::text) <= 65536)
);

create index intake_extraction_runs_conversation_idx
  on public.intake_extraction_runs (organization_id, conversation_id, started_at desc, id desc);

-- intake_drafts — the "待確認進件草稿". One active (pending_review) row per
-- conversation. origin distinguishes an AI draft from a degraded manual draft.
create table public.intake_drafts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  conversation_id uuid not null,
  status text not null default 'pending_review',
  origin text not null,
  confidence numeric(4,3),
  fields jsonb not null default '{}'::jsonb,
  summary text,
  title text,
  missing_fields text[] not null default '{}'::text[],
  extraction_run_id uuid,
  converted_service_request_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  lock_version integer not null default 1,
  constraint intake_drafts_org_id_uidx unique (organization_id, id),
  constraint intake_drafts_conversation_fk foreign key (organization_id, conversation_id)
    references public.conversations (organization_id, id) on delete restrict,
  constraint intake_drafts_run_fk foreign key (organization_id, extraction_run_id)
    references public.intake_extraction_runs (organization_id, id) on delete restrict,
  constraint intake_drafts_service_request_fk foreign key (organization_id, converted_service_request_id)
    references public.service_requests (organization_id, id) on delete restrict,
  constraint intake_drafts_status_chk check (
    status in ('pending_review', 'confirmed', 'dismissed', 'superseded')
  ),
  constraint intake_drafts_origin_chk check (origin in ('ai', 'manual')),
  constraint intake_drafts_confidence_chk check (
    confidence is null or (confidence >= 0 and confidence <= 1)
  ),
  constraint intake_drafts_fields_size_chk check (octet_length(fields::text) <= 65536),
  constraint intake_drafts_summary_length_chk check (summary is null or char_length(summary) <= 4000),
  constraint intake_drafts_title_length_chk check (title is null or char_length(title) <= 160),
  constraint intake_drafts_converted_shape_chk check (
    status <> 'confirmed' or converted_service_request_id is not null
  ),
  constraint intake_drafts_lock_version_chk check (lock_version > 0)
);

-- One active draft per conversation. Confirmed/dismissed/superseded rows are
-- unconstrained so history is preserved.
create unique index intake_drafts_one_active_per_conversation_uidx
  on public.intake_drafts (organization_id, conversation_id)
  where status = 'pending_review';
create index intake_drafts_status_recent_idx
  on public.intake_drafts (organization_id, status, updated_at desc, id desc);

------------------------------------------------------------------------------
-- 2. RLS, ownership, grants (mirrors the pilot-intake late-table pattern)
------------------------------------------------------------------------------

alter table public.conversations owner to renoly_rls_owner;
alter table public.inbound_messages owner to renoly_rls_owner;
alter table public.message_attachments owner to renoly_rls_owner;
alter table public.intake_extraction_runs owner to renoly_rls_owner;
alter table public.intake_drafts owner to renoly_rls_owner;

do $$
declare
  t text;
begin
  foreach t in array array[
    'conversations', 'inbound_messages', 'message_attachments',
    'intake_extraction_runs', 'intake_drafts'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    -- No PostgREST role may mutate these directly; all writes flow through the
    -- security-definer worker/staff RPCs below.
    execute format('revoke all on public.%I from public, anon, authenticated, service_role', t);
  end loop;
end
$$;

-- Staff inbox read path: owner/admin/dispatcher may SELECT (RLS-scoped). No
-- insert/update/delete grant — the RPCs own every mutation.
grant select on public.conversations to authenticated;
grant select on public.inbound_messages to authenticated;
grant select on public.message_attachments to authenticated;
grant select on public.intake_extraction_runs to authenticated;
grant select on public.intake_drafts to authenticated;

create policy conversations_select_manager on public.conversations
for select to authenticated
using ((select public.has_org_role(organization_id, array['owner', 'admin', 'dispatcher']::text[])));

create policy inbound_messages_select_manager on public.inbound_messages
for select to authenticated
using ((select public.has_org_role(organization_id, array['owner', 'admin', 'dispatcher']::text[])));

create policy message_attachments_select_manager on public.message_attachments
for select to authenticated
using ((select public.has_org_role(organization_id, array['owner', 'admin', 'dispatcher']::text[])));

create policy intake_extraction_runs_select_manager on public.intake_extraction_runs
for select to authenticated
using ((select public.has_org_role(organization_id, array['owner', 'admin', 'dispatcher']::text[])));

create policy intake_drafts_select_manager on public.intake_drafts
for select to authenticated
using ((select public.has_org_role(organization_id, array['owner', 'admin', 'dispatcher']::text[])));

------------------------------------------------------------------------------
-- 3. Append-only / write-once guards
------------------------------------------------------------------------------

-- inbound_messages: raw + text_content are write-once (mirror
-- private.guard_original_submission). Any later change is rejected.
create or replace function private.guard_inbound_message_immutable()
returns trigger
language plpgsql
set search_path = pg_catalog, public, private
as $$
begin
  if new.raw is distinct from old.raw then
    raise exception using errcode = 'P0001', message = 'INBOUND_MESSAGE_IMMUTABLE';
  end if;
  if new.text_content is distinct from old.text_content then
    raise exception using errcode = 'P0001', message = 'INBOUND_MESSAGE_IMMUTABLE';
  end if;
  return new;
end;
$$;

alter function private.guard_inbound_message_immutable() owner to renoly_rls_owner;
revoke all on function private.guard_inbound_message_immutable() from public, anon, authenticated, service_role;

create trigger b_guard_inbound_message_immutable
before update on public.inbound_messages
for each row execute function private.guard_inbound_message_immutable();

-- intake_extraction_runs are append-only.
create trigger immutable_intake_extraction_runs
before update or delete on public.intake_extraction_runs
for each row execute function private.prevent_append_only_mutation();

------------------------------------------------------------------------------
-- 4. events allowlist: add 'conversation' and 'intake_draft' aggregate types
--    (mirrors how M3 added 'customer').
------------------------------------------------------------------------------

alter table public.events drop constraint events_aggregate_type_chk;
alter table public.events add constraint events_aggregate_type_chk check (
  aggregate_type in (
    'customer', 'conversation', 'intake_draft', 'service_request', 'project',
    'work_order', 'quote', 'change_order', 'payment_milestone',
    'maintenance_plan', 'line_channel'
  )
);

------------------------------------------------------------------------------
-- 5. ingest_inbound_message — worker landing from a claimed webhook message
--    event. find-or-create the open conversation, append the message
--    (ON CONFLICT dedup DO NOTHING), bump aggregate counts. service_role only.
--    Returns { conversationId, messageId, duplicate }.
------------------------------------------------------------------------------

create or replace function public.ingest_inbound_message(
  p_webhook_event_id uuid,
  p_line_message_id text,
  p_message_type text,
  p_text_content text,
  p_raw jsonb,
  p_line_user_id text,
  p_customer_line_identity_id uuid default null,
  p_sent_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_event public.line_webhook_events%rowtype;
  v_conversation_id uuid;
  v_message_id uuid;
  v_now timestamptz := clock_timestamp();
begin
  select * into v_event from public.line_webhook_events where id = p_webhook_event_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'WEBHOOK_EVENT_NOT_FOUND';
  end if;

  if p_message_type is null or p_message_type not in ('text', 'image', 'sticker', 'other') then
    raise exception using errcode = '23514', message = 'INVALID_MESSAGE_TYPE';
  end if;
  if p_line_user_id is null or char_length(btrim(p_line_user_id)) = 0 then
    raise exception using errcode = '23514', message = 'LINE_USER_ID_REQUIRED';
  end if;

  -- Dedup fast-path: the same LINE message id already landed on this channel.
  if p_line_message_id is not null then
    select id, conversation_id into v_message_id, v_conversation_id
    from public.inbound_messages
    where organization_id = v_event.organization_id
      and line_channel_id = v_event.line_channel_id
      and line_message_id = p_line_message_id;
    if found then
      return jsonb_build_object(
        'conversationId', v_conversation_id, 'messageId', v_message_id, 'duplicate', true
      );
    end if;
  end if;

  -- find-or-create the single open conversation for this sender.
  select id into v_conversation_id
  from public.conversations
  where organization_id = v_event.organization_id
    and line_channel_id = v_event.line_channel_id
    and line_user_id = p_line_user_id
    and status = 'open'
  for update;

  if v_conversation_id is null then
    insert into public.conversations (
      organization_id, line_channel_id, customer_line_identity_id, line_user_id,
      status, last_message_at, message_count
    ) values (
      v_event.organization_id, v_event.line_channel_id, p_customer_line_identity_id,
      p_line_user_id, 'open', coalesce(p_sent_at, v_now), 0
    )
    returning id into v_conversation_id;
  elsif p_customer_line_identity_id is not null then
    -- Late-bound identity: attach it to the open conversation if still unset.
    update public.conversations
    set customer_line_identity_id = coalesce(customer_line_identity_id, p_customer_line_identity_id)
    where id = v_conversation_id;
  end if;

  insert into public.inbound_messages (
    organization_id, conversation_id, line_channel_id, line_webhook_event_id,
    line_message_id, message_type, text_content, raw, sent_at, received_at
  ) values (
    v_event.organization_id, v_conversation_id, v_event.line_channel_id, p_webhook_event_id,
    p_line_message_id, p_message_type, p_text_content, coalesce(p_raw, '{}'::jsonb),
    p_sent_at, v_now
  )
  on conflict (organization_id, line_channel_id, line_message_id)
    where line_message_id is not null do nothing
  returning id into v_message_id;

  if v_message_id is null then
    -- A concurrent insert won the dedup race; surface the existing row.
    select id into v_message_id
    from public.inbound_messages
    where organization_id = v_event.organization_id
      and line_channel_id = v_event.line_channel_id
      and line_message_id = p_line_message_id;
    return jsonb_build_object(
      'conversationId', v_conversation_id, 'messageId', v_message_id, 'duplicate', true
    );
  end if;

  update public.conversations
  set message_count = message_count + 1,
      last_message_at = greatest(coalesce(last_message_at, v_now), coalesce(p_sent_at, v_now)),
      updated_at = v_now,
      lock_version = lock_version + 1
  where id = v_conversation_id;

  return jsonb_build_object(
    'conversationId', v_conversation_id, 'messageId', v_message_id, 'duplicate', false
  );
end;
$$;

alter function public.ingest_inbound_message(uuid, text, text, text, jsonb, text, uuid, timestamptz)
  owner to renoly_rls_owner;
revoke all on function public.ingest_inbound_message(uuid, text, text, text, jsonb, text, uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.ingest_inbound_message(uuid, text, text, text, jsonb, text, uuid, timestamptz)
  to service_role;

------------------------------------------------------------------------------
-- 6. attach_message_media — worker records a downloaded LINE image
--    (via the M2 photo pipeline). service_role only. Returns { id }.
------------------------------------------------------------------------------

create or replace function public.attach_message_media(
  p_org uuid,
  p_inbound_message_id uuid,
  p_status text,
  p_storage_path text default null,
  p_thumbnail_path text default null,
  p_content_hash text default null,
  p_mime_type text default null,
  p_byte_size bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_id uuid;
begin
  if not exists (
    select 1 from public.inbound_messages
    where organization_id = p_org and id = p_inbound_message_id
  ) then
    raise exception using errcode = 'P0002', message = 'INBOUND_MESSAGE_NOT_FOUND';
  end if;

  insert into public.message_attachments (
    organization_id, inbound_message_id, kind, status, storage_path,
    thumbnail_path, content_hash, mime_type, byte_size
  ) values (
    p_org, p_inbound_message_id, 'image', coalesce(p_status, 'pending'),
    p_storage_path, p_thumbnail_path, p_content_hash, p_mime_type, p_byte_size
  )
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'status', coalesce(p_status, 'pending'));
end;
$$;

alter function public.attach_message_media(uuid, uuid, text, text, text, text, text, bigint)
  owner to renoly_rls_owner;
revoke all on function public.attach_message_media(uuid, uuid, text, text, text, text, text, bigint)
  from public, anon, authenticated;
grant execute on function public.attach_message_media(uuid, uuid, text, text, text, text, text, bigint)
  to service_role;

------------------------------------------------------------------------------
-- 7. record_extraction_run — THE DEGRADATION GATE. A single transaction writes
--    the audit run AND upserts the single active draft for the conversation.
--    * status='succeeded'/'degraded' -> origin='ai' draft (summary/fields).
--    * status='failed'               -> origin='manual' draft (AI output empty),
--      so the inbound message is NEVER lost when the extractor is down.
--    Idempotent per conversation: an existing pending_review draft is updated in
--    place (never a second active draft). service_role only.
--    Returns { runId, draftId, origin, draftStatus }.
------------------------------------------------------------------------------

create or replace function public.record_extraction_run(
  p_org uuid,
  p_conversation_id uuid,
  p_extractor_name text,
  p_status text,
  p_input_message_ids uuid[],
  p_model_version text default null,
  p_confidence numeric default null,
  p_summary text default null,
  p_title text default null,
  p_fields jsonb default null,
  p_missing_fields text[] default null,
  p_output jsonb default null,
  p_error_code text default null,
  p_latency_ms integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_run_id uuid;
  v_draft_id uuid;
  v_origin text;
  v_now timestamptz := clock_timestamp();
begin
  -- Lock the conversation aggregate root so concurrent runs serialize on the
  -- single-active-draft invariant.
  perform 1 from public.conversations
  where organization_id = p_org and id = p_conversation_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'CONVERSATION_NOT_FOUND';
  end if;

  if p_status is null or p_status not in ('succeeded', 'failed', 'degraded') then
    raise exception using errcode = '23514', message = 'INVALID_EXTRACTION_STATUS';
  end if;

  -- A failed extraction degrades to a manual draft; success/degraded yield an
  -- AI draft. Either way a draft exists so intake is never blocked.
  v_origin := case when p_status = 'failed' then 'manual' else 'ai' end;
  v_run_id := gen_random_uuid();

  -- Upsert the single active draft FIRST so the append-only run can carry
  -- intake_draft_id at insert time (the run table forbids post-insert UPDATE).
  select id into v_draft_id
  from public.intake_drafts
  where organization_id = p_org and conversation_id = p_conversation_id
    and status = 'pending_review'
  for update;

  if v_draft_id is null then
    insert into public.intake_drafts (
      organization_id, conversation_id, status, origin, confidence, fields,
      summary, title, missing_fields, extraction_run_id
    ) values (
      p_org, p_conversation_id, 'pending_review', v_origin,
      case when p_status = 'failed' then null else p_confidence end,
      case when p_status = 'failed' then '{}'::jsonb else coalesce(p_fields, '{}'::jsonb) end,
      case when p_status = 'failed' then null else p_summary end,
      case when p_status = 'failed' then null else p_title end,
      coalesce(p_missing_fields, '{}'::text[]), null
    )
    returning id into v_draft_id;
  end if;

  -- Insert the append-only run with intake_draft_id known (the run table forbids
  -- a later UPDATE), then link the draft back to it.
  insert into public.intake_extraction_runs (
    id, organization_id, conversation_id, intake_draft_id, extractor_name,
    model_version, status, confidence, input_message_ids, output, error_code,
    latency_ms, started_at, finished_at
  ) values (
    v_run_id, p_org, p_conversation_id, v_draft_id, p_extractor_name,
    p_model_version, p_status,
    case when p_status = 'failed' then null else p_confidence end,
    coalesce(p_input_message_ids, '{}'::uuid[]),
    case when p_status = 'failed' then null else p_output end,
    p_error_code, p_latency_ms, v_now, v_now
  );

  update public.intake_drafts
  set origin = v_origin,
      confidence = case when p_status = 'failed' then null else p_confidence end,
      fields = case when p_status = 'failed' then '{}'::jsonb else coalesce(p_fields, '{}'::jsonb) end,
      summary = case when p_status = 'failed' then null else p_summary end,
      title = case when p_status = 'failed' then null else p_title end,
      missing_fields = coalesce(p_missing_fields, '{}'::text[]),
      extraction_run_id = v_run_id,
      updated_at = v_now,
      lock_version = lock_version + 1
  where id = v_draft_id;

  return jsonb_build_object(
    'runId', v_run_id, 'draftId', v_draft_id, 'origin', v_origin, 'draftStatus', 'pending_review'
  );
end;
$$;

alter function public.record_extraction_run(uuid, uuid, text, text, uuid[], text, numeric, text, text, jsonb, text[], jsonb, text, integer)
  owner to renoly_rls_owner;
revoke all on function public.record_extraction_run(uuid, uuid, text, text, uuid[], text, numeric, text, text, jsonb, text[], jsonb, text, integer)
  from public, anon, authenticated;
grant execute on function public.record_extraction_run(uuid, uuid, text, text, uuid[], text, numeric, text, text, jsonb, text[], jsonb, text, integer)
  to service_role;

------------------------------------------------------------------------------
-- 8. create_intake_draft — worker helper to (re)create a manual draft with no
--    extraction run (e.g. an image-only conversation the operator must read).
--    Mirrors the degradation shape without an AI attempt. service_role only.
------------------------------------------------------------------------------

create or replace function public.create_intake_draft(
  p_org uuid,
  p_conversation_id uuid,
  p_origin text default 'manual',
  p_summary text default null,
  p_title text default null,
  p_fields jsonb default null,
  p_missing_fields text[] default null,
  p_confidence numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_draft_id uuid;
  v_now timestamptz := clock_timestamp();
begin
  if not exists (
    select 1 from public.conversations where organization_id = p_org and id = p_conversation_id
  ) then
    raise exception using errcode = 'P0002', message = 'CONVERSATION_NOT_FOUND';
  end if;
  if p_origin is null or p_origin not in ('ai', 'manual') then
    raise exception using errcode = '23514', message = 'INVALID_DRAFT_ORIGIN';
  end if;

  select id into v_draft_id
  from public.intake_drafts
  where organization_id = p_org and conversation_id = p_conversation_id and status = 'pending_review'
  for update;

  if v_draft_id is null then
    insert into public.intake_drafts (
      organization_id, conversation_id, status, origin, confidence, fields,
      summary, title, missing_fields
    ) values (
      p_org, p_conversation_id, 'pending_review', p_origin, p_confidence,
      coalesce(p_fields, '{}'::jsonb), p_summary, p_title, coalesce(p_missing_fields, '{}'::text[])
    )
    returning id into v_draft_id;
  else
    update public.intake_drafts
    set origin = p_origin,
        confidence = p_confidence,
        fields = coalesce(p_fields, '{}'::jsonb),
        summary = p_summary,
        title = p_title,
        missing_fields = coalesce(p_missing_fields, '{}'::text[]),
        updated_at = v_now,
        lock_version = lock_version + 1
    where id = v_draft_id;
  end if;

  return jsonb_build_object('draftId', v_draft_id, 'origin', p_origin, 'draftStatus', 'pending_review');
end;
$$;

alter function public.create_intake_draft(uuid, uuid, text, text, text, jsonb, text[], numeric)
  owner to renoly_rls_owner;
revoke all on function public.create_intake_draft(uuid, uuid, text, text, text, jsonb, text[], numeric)
  from public, anon, authenticated;
grant execute on function public.create_intake_draft(uuid, uuid, text, text, text, jsonb, text[], numeric)
  to service_role;

------------------------------------------------------------------------------
-- 9. confirm_intake_draft — staff-facing. ATOMICALLY creates a service_request
--    (source='line', customer_line_identity_id, source_reference=conversation_id,
--    original_submission=message snapshot) from the draft, marks the draft
--    confirmed + links converted_service_request_id, moves the conversation to
--    'drafted', and appends an intake_draft event. owner/admin/dispatcher only.
--
--    confirm-once: the existing service_requests (org, source, source_reference)
--    partial unique makes a replay return the SAME service_request. authenticated.
------------------------------------------------------------------------------

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

------------------------------------------------------------------------------
-- 10. dismiss_intake_draft — staff-facing. Marks a pending_review draft
--     'dismissed' (spam / unparseable) and moves the conversation to
--     'dismissed'. owner/admin/dispatcher only. authenticated.
------------------------------------------------------------------------------

create or replace function public.dismiss_intake_draft(
  target_org uuid,
  target_draft uuid,
  expected_lock_version integer,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_draft public.intake_drafts%rowtype;
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

  if v_draft.status = 'dismissed' then
    return jsonb_build_object('draftId', v_draft.id, 'draftStatus', 'dismissed', 'replayed', true);
  end if;
  if v_draft.status <> 'pending_review' then
    raise exception using errcode = '23514', message = 'INTAKE_DRAFT_NOT_DISMISSABLE';
  end if;
  if v_draft.lock_version is distinct from expected_lock_version then
    raise exception using errcode = '40001', message = 'STALE_VERSION';
  end if;

  update public.intake_drafts
  set status = 'dismissed', updated_at = clock_timestamp(), lock_version = lock_version + 1
  where id = v_draft.id;

  update public.conversations
  set status = 'dismissed', updated_at = clock_timestamp(), lock_version = lock_version + 1
  where organization_id = target_org and id = v_draft.conversation_id and status = 'open';

  perform private.append_user_event(
    target_org, 'intake_draft', v_draft.id, 'intake_draft.dismissed',
    jsonb_build_object('conversationId', v_draft.conversation_id, 'reason', p_reason),
    null, null, null
  );

  return jsonb_build_object('draftId', v_draft.id, 'draftStatus', 'dismissed', 'replayed', false);
end;
$$;

alter function public.dismiss_intake_draft(uuid, uuid, integer, text)
  owner to renoly_rls_owner;
revoke all on function public.dismiss_intake_draft(uuid, uuid, integer, text)
  from public, anon, service_role;
grant execute on function public.dismiss_intake_draft(uuid, uuid, integer, text) to authenticated;

------------------------------------------------------------------------------
-- 11. claim_intake_extraction_runs — extraction worker claim. Returns open
--     conversations (status='open') that have inbound messages but NO active
--     draft yet, oldest-first, SKIP LOCKED. service_role only. Mirrors
--     claim_line_webhook_events. Returns a jsonb array of conversation claims.
------------------------------------------------------------------------------

create or replace function public.claim_intake_extraction_runs(
  p_worker_id text,
  p_limit integer default 10,
  p_now timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 10), 50));
  v_now timestamptz := coalesce(p_now, clock_timestamp());
  v_result jsonb;
begin
  with claimable as (
    select c.id
    from public.conversations c
    where c.status = 'open'
      and c.message_count > 0
      -- Quiet-window gate: don't extract mid-burst; wait until the sender's
      -- latest message is at/behind the claim clock.
      and coalesce(c.last_message_at, c.created_at) <= v_now
      and not exists (
        select 1 from public.intake_drafts d
        where d.organization_id = c.organization_id
          and d.conversation_id = c.id
          and d.status = 'pending_review'
      )
    order by c.last_message_at, c.created_at, c.id
    limit v_limit
    for update of c skip locked
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'conversationId', c.id,
    'organizationId', c.organization_id,
    'lineChannelId', c.line_channel_id,
    'lineUserId', c.line_user_id,
    'customerLineIdentityId', c.customer_line_identity_id,
    'messageCount', c.message_count,
    'claimedBy', p_worker_id,
    'messages', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', m.id,
        'messageType', m.message_type,
        'textContent', m.text_content,
        'sentAt', m.sent_at
      ) order by m.received_at, m.id), '[]'::jsonb)
      from public.inbound_messages m
      where m.organization_id = c.organization_id and m.conversation_id = c.id
    )
  )), '[]'::jsonb)
  into v_result
  from public.conversations c
  join claimable cl on cl.id = c.id;

  return v_result;
end;
$$;

alter function public.claim_intake_extraction_runs(text, integer, timestamptz)
  owner to renoly_rls_owner;
revoke all on function public.claim_intake_extraction_runs(text, integer, timestamptz)
  from public, anon, authenticated;
grant execute on function public.claim_intake_extraction_runs(text, integer, timestamptz)
  to service_role;

------------------------------------------------------------------------------
-- 12. mark_extraction_succeeded / mark_extraction_failed — thin wrappers over
--     record_extraction_run so the worker mirrors the M6 mark_* verbs. Both are
--     service_role only. mark_extraction_failed is the DEGRADATION verb (still
--     yields a manual draft).
------------------------------------------------------------------------------

create or replace function public.mark_extraction_succeeded(
  p_org uuid,
  p_conversation_id uuid,
  p_extractor_name text,
  p_input_message_ids uuid[],
  p_confidence numeric,
  p_summary text,
  p_title text,
  p_fields jsonb,
  p_missing_fields text[] default null,
  p_model_version text default null,
  p_output jsonb default null,
  p_latency_ms integer default null
)
returns jsonb
language sql
security definer
set search_path = pg_catalog, public, private
as $$
  select public.record_extraction_run(
    p_org, p_conversation_id, p_extractor_name, 'succeeded', p_input_message_ids,
    p_model_version, p_confidence, p_summary, p_title, p_fields, p_missing_fields,
    p_output, null, p_latency_ms
  );
$$;

alter function public.mark_extraction_succeeded(uuid, uuid, text, uuid[], numeric, text, text, jsonb, text[], text, jsonb, integer)
  owner to renoly_rls_owner;
revoke all on function public.mark_extraction_succeeded(uuid, uuid, text, uuid[], numeric, text, text, jsonb, text[], text, jsonb, integer)
  from public, anon, authenticated;
grant execute on function public.mark_extraction_succeeded(uuid, uuid, text, uuid[], numeric, text, text, jsonb, text[], text, jsonb, integer)
  to service_role;

create or replace function public.mark_extraction_failed(
  p_org uuid,
  p_conversation_id uuid,
  p_extractor_name text,
  p_input_message_ids uuid[],
  p_error_code text,
  p_latency_ms integer default null
)
returns jsonb
language sql
security definer
set search_path = pg_catalog, public, private
as $$
  select public.record_extraction_run(
    p_org, p_conversation_id, p_extractor_name, 'failed', p_input_message_ids,
    null, null, null, null, null, null, null, p_error_code, p_latency_ms
  );
$$;

alter function public.mark_extraction_failed(uuid, uuid, text, uuid[], text, integer)
  owner to renoly_rls_owner;
revoke all on function public.mark_extraction_failed(uuid, uuid, text, uuid[], text, integer)
  from public, anon, authenticated;
grant execute on function public.mark_extraction_failed(uuid, uuid, text, uuid[], text, integer)
  to service_role;
