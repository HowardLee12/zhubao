begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(16);

select throws_ok(
  $$update public.events set event_type = 'tampered' where id = '89100000-0000-4000-8000-000000000001'$$,
  'P0001', 'APPEND_ONLY_RECORD', 'events are append-only'
);

select throws_ok(
  $$update public.quote_versions set title = 'tampered' where id = '85100000-0000-4000-8000-000000000002'$$,
  'P0001', 'QUOTE_VERSION_IMMUTABLE', 'sent quote versions are immutable'
);

select throws_ok(
  $$update public.quote_items set name = 'tampered' where id = '85200000-0000-4000-8000-000000000003'$$,
  'P0001', 'QUOTE_VERSION_IMMUTABLE', 'sent quote items are immutable'
);

select throws_ok(
  $$insert into public.locations (
      id, organization_id, customer_id, label, address_line
    ) values (
      '59900000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      '40000000-0000-4000-8000-000000000003',
      'cross tenant', 'invalid'
    )$$,
  '23503', null, 'composite FK blocks cross-tenant customer links'
);

select throws_ok(
  $$insert into public.public_access_tokens (
      organization_id, resource_type, resource_id, token_hash, scopes, expires_at
    ) values (
      '20000000-0000-4000-8000-000000000001', 'quote',
      '85100000-0000-4000-8000-000000000002',
      extensions.digest('invalid-scope-fixture', 'sha256'), array['admin:*'],
      statement_timestamp() + interval '1 day'
    )$$,
  '23514', null, 'public token scopes are resource allowlisted'
);

select throws_ok(
  $$insert into public.public_access_tokens (
      organization_id, resource_type, resource_id, token_hash, scopes, expires_at
    ) values (
      '20000000-0000-4000-8000-000000000001', 'intake_form',
      '20000000-0000-4000-8000-000000000002',
      extensions.digest('cross-tenant-intake-form', 'sha256'), array['intake:create'],
      statement_timestamp() + interval '1 day'
    )$$,
  '23503', 'PUBLIC_TOKEN_RESOURCE_NOT_FOUND', 'intake tokens bind to their organization'
);

select throws_ok(
  $$insert into public.public_access_tokens (
      organization_id, resource_type, resource_id, token_hash, scopes, expires_at
    ) values (
      '20000000-0000-4000-8000-000000000001', 'quote',
      '85000000-0000-4000-8000-000000000002',
      extensions.digest('aggregate-not-version-token', 'sha256'), array['quote:read'],
      statement_timestamp() + interval '1 day'
    )$$,
  '23503', 'PUBLIC_TOKEN_RESOURCE_NOT_FOUND', 'quote tokens bind to an immutable version'
);

select throws_ok(
  $$insert into public.public_access_tokens (
      organization_id, resource_type, resource_id, token_hash, scopes, expires_at
    ) values (
      '20000000-0000-4000-8000-000000000001', 'change_order',
      '86000000-0000-4000-8000-000000000001',
      extensions.digest('draft-change-order-token', 'sha256'),
      array['change_order:read', 'change_order:respond'],
      statement_timestamp() + interval '1 day'
    )$$,
  '23503', 'PUBLIC_TOKEN_RESOURCE_NOT_FOUND', 'draft change orders cannot mint customer response tokens'
);

select throws_ok(
  $$insert into public.public_access_tokens (
      organization_id, resource_type, resource_id, token_hash, scopes, expires_at
    ) values (
      '20000000-0000-4000-8000-000000000001', 'work_order_signoff',
      '82000000-0000-4000-8000-000000000001',
      extensions.digest('premature-work-order-signoff', 'sha256'),
      array['work_order:signoff'], statement_timestamp() + interval '1 day'
    )$$,
  '23503', 'PUBLIC_TOKEN_RESOURCE_NOT_FOUND', 'work-order signoff tokens require an unsigned on-site signoff state'
);

insert into public.public_access_tokens (
  organization_id, resource_type, resource_id, token_hash, scopes, expires_at
) values (
  '20000000-0000-4000-8000-000000000001', 'quote',
  '85100000-0000-4000-8000-000000000002',
  extensions.digest('null-scope-token', 'sha256'), array['quote:read'],
  statement_timestamp() + interval '1 day'
);
select throws_ok(
  $$select * from public.consume_public_access_token(
      extensions.digest('null-scope-token', 'sha256'), null
    )$$,
  '42501', 'PUBLIC_TOKEN_INVALID', 'null required scope fails closed'
);

select throws_ok(
  $$select public.create_photo_upload(
      '20000000-0000-4000-8000-000000000001', 'work_order',
      '82000000-0000-4000-8000-000000000001', 'before', 'before.jpg',
      null, 1024, repeat('a', 64)
    )$$,
  '22023', 'PHOTO_UPLOAD_DECLARATION_INVALID', 'null upload MIME type fails closed'
);

select throws_ok(
  $$select public.create_photo_upload(
      '20000000-0000-4000-8000-000000000001', 'work_order',
      '82000000-0000-4000-8000-000000000001', 'before', 'before.jpg',
      'image/jpeg', 1024, 'not-a-sha256'
    )$$,
  '22023', 'PHOTO_UPLOAD_DECLARATION_INVALID', 'invalid declared checksum fails closed'
);

insert into public.photos (
  id, organization_id, work_order_id, category, status, storage_path,
  original_filename, mime_type, byte_size
) values (
  '89900000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  '82000000-0000-4000-8000-000000000001', 'before', 'pending',
  'org/20000000-0000-4000-8000-000000000001/work-orders/82000000-0000-4000-8000-000000000001/89900000-0000-4000-8000-000000000001/upload',
  'before.jpg', 'image/jpeg', 1024
);
select throws_ok(
  $$update public.photos
    set work_order_id = null,
        service_request_id = '80000000-0000-4000-8000-000000000002',
        checklist_item_id = null,
        storage_path = 'org/20000000-0000-4000-8000-000000000001/service-requests/80000000-0000-4000-8000-000000000002/89900000-0000-4000-8000-000000000001/upload'
    where id = '89900000-0000-4000-8000-000000000001'$$,
  'P0001', 'WORK_ORDER_SNAPSHOT_PARENT_IMMUTABLE', 'photo parent cannot be changed after creation'
);

insert into public.public_access_tokens (
  organization_id, resource_type, resource_id, token_hash, scopes, expires_at
) values (
  '20000000-0000-4000-8000-000000000001', 'quote',
  '85100000-0000-4000-8000-000000000002',
  extensions.digest('inactive-org-token', 'sha256'), array['quote:read'],
  statement_timestamp() + interval '1 day'
);
update public.organizations
set status = 'suspended'
where id = '20000000-0000-4000-8000-000000000001';
select throws_ok(
  $$select * from public.consume_public_access_token(
      extensions.digest('inactive-org-token', 'sha256'), 'quote:read'
    )$$,
  '42501', 'PUBLIC_TOKEN_INVALID', 'suspending an organization disables its public links'
);

select is(
  (select approval_status from public.quote_versions where id = '85100000-0000-4000-8000-000000000001'),
  'not_submitted',
  'draft quote uses canonical not_submitted approval state'
);

select is(
  (select approval_status from public.quote_versions where id = '85100000-0000-4000-8000-000000000002'),
  'approved',
  'sent quote fixture is owner approved'
);

select * from finish();
rollback;
