-- Renoly v2 clean-slate foundation.
-- Source of truth starts in supabase/migrations; legacy loose SQL files are not run.

create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;

revoke all on schema private from public;
revoke all on schema private from anon;
revoke all on schema private from authenticated;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  new.updated_at = statement_timestamp();
  return new;
end;
$$;

revoke all on function public.touch_updated_at() from public;

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  slug text not null,
  name text not null,
  legal_name text,
  tax_id text,
  phone text,
  timezone text not null default 'Asia/Taipei',
  currency text not null default 'TWD',
  industry_template text not null default 'general_field_service',
  status text not null default 'active',
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  lock_version integer not null default 1,
  constraint organizations_slug_format_chk
    check (slug ~ '^[a-z0-9][a-z0-9-]{0,48}[a-z0-9]$'),
  constraint organizations_name_length_chk check (char_length(name) between 1 and 120),
  constraint organizations_legal_name_length_chk check (legal_name is null or char_length(legal_name) <= 200),
  constraint organizations_tax_id_length_chk check (tax_id is null or char_length(tax_id) <= 20),
  constraint organizations_phone_format_chk check (phone is null or phone ~ '^\+[1-9][0-9]{7,14}$'),
  constraint organizations_timezone_length_chk check (char_length(timezone) between 1 and 64),
  constraint organizations_currency_chk check (currency ~ '^[A-Z]{3}$'),
  constraint organizations_industry_template_chk check (
    industry_template in ('general_field_service', 'cooling', 'plumbing', 'waterproofing', 'renovation')
  ),
  constraint organizations_status_chk check (status in ('active', 'suspended', 'closed')),
  constraint organizations_settings_size_chk check (octet_length(settings::text) <= 32768),
  constraint organizations_lock_version_chk check (lock_version > 0)
);

create unique index organizations_slug_lower_uidx on public.organizations (lower(slug));
create index organizations_status_created_idx on public.organizations (status, created_at, id);

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict,
  role text not null,
  status text not null default 'invited',
  display_name text not null,
  phone text,
  invited_by uuid references auth.users(id) on delete set null,
  invited_at timestamptz,
  joined_at timestamptz,
  suspended_at timestamptz,
  removed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  lock_version integer not null default 1,
  constraint memberships_org_id_uidx unique (organization_id, id),
  constraint memberships_org_user_uidx unique (organization_id, user_id),
  constraint memberships_role_chk check (role in ('owner', 'admin', 'dispatcher', 'technician', 'accountant', 'viewer')),
  constraint memberships_status_chk check (status in ('invited', 'active', 'suspended', 'removed')),
  constraint memberships_display_name_length_chk check (char_length(display_name) between 1 and 80),
  constraint memberships_phone_format_chk check (phone is null or phone ~ '^\+[1-9][0-9]{7,14}$'),
  constraint memberships_lock_version_chk check (lock_version > 0),
  constraint memberships_lifecycle_chk check (
    (status <> 'active' or joined_at is not null)
    and (status <> 'suspended' or suspended_at is not null)
    and (status <> 'removed' or removed_at is not null)
  )
);

create index memberships_user_status_idx on public.memberships (user_id, status, organization_id);
create index memberships_org_role_status_idx on public.memberships (organization_id, role, status, id);

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  customer_no text not null,
  kind text not null default 'individual',
  name text not null,
  phone text,
  email text,
  company_name text,
  tax_id text,
  source text not null default 'manual',
  tags text[] not null default '{}'::text[],
  notes text not null default '',
  marketing_consent_at timestamptz,
  marketing_consent_source text,
  last_contact_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  lock_version integer not null default 1,
  constraint customers_org_id_uidx unique (organization_id, id),
  constraint customers_org_no_uidx unique (organization_id, customer_no),
  constraint customers_kind_chk check (kind in ('individual', 'company')),
  constraint customers_name_length_chk check (char_length(name) between 1 and 120),
  constraint customers_phone_format_chk check (phone is null or phone ~ '^\+[1-9][0-9]{7,14}$'),
  constraint customers_email_chk check (
    email is null or (email = lower(email) and char_length(email) <= 254 and position('@' in email) > 1)
  ),
  constraint customers_company_name_length_chk check (company_name is null or char_length(company_name) <= 200),
  constraint customers_tax_id_length_chk check (tax_id is null or char_length(tax_id) <= 20),
  constraint customers_source_chk check (source in ('line', 'phone', 'web', 'referral', 'manual', 'import')),
  constraint customers_tags_count_chk check (cardinality(tags) <= 20),
  constraint customers_tags_item_length_chk check (array_position(tags, null) is null),
  constraint customers_notes_length_chk check (char_length(notes) <= 5000),
  constraint customers_marketing_source_length_chk check (
    marketing_consent_source is null or char_length(marketing_consent_source) <= 200
  ),
  constraint customers_lock_version_chk check (lock_version > 0)
);

create index customers_org_name_idx on public.customers (organization_id, lower(name), id) where deleted_at is null;
create index customers_org_phone_idx on public.customers (organization_id, phone, id) where deleted_at is null and phone is not null;
create index customers_org_last_contact_idx on public.customers (organization_id, last_contact_at desc, id desc) where deleted_at is null;

create table public.line_channels (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  name text not null,
  channel_id text not null,
  basic_id text,
  liff_id text,
  status text not null default 'pending',
  webhook_verified_at timestamptz,
  last_webhook_at timestamptz,
  last_error_code text,
  credential_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  lock_version integer not null default 1,
  constraint line_channels_org_id_uidx unique (organization_id, id),
  constraint line_channels_channel_id_uidx unique (channel_id),
  constraint line_channels_name_length_chk check (char_length(name) between 1 and 120),
  constraint line_channels_channel_id_length_chk check (char_length(channel_id) between 1 and 120),
  constraint line_channels_status_chk check (status in ('pending', 'active', 'disabled', 'error')),
  constraint line_channels_credential_version_chk check (credential_version > 0),
  constraint line_channels_lock_version_chk check (lock_version > 0)
);

create unique index line_channels_one_active_per_org_uidx
  on public.line_channels (organization_id)
  where status = 'active';

create table public.customer_line_identities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  customer_id uuid not null,
  line_channel_id uuid not null,
  line_user_id text not null,
  display_name text,
  picture_url text,
  friend_status text not null default 'unknown',
  followed_at timestamptz,
  unfollowed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customer_line_identities_org_id_uidx unique (organization_id, id),
  constraint customer_line_identities_org_id_customer_uidx unique (organization_id, id, customer_id),
  constraint customer_line_identities_channel_user_uidx unique (line_channel_id, line_user_id),
  constraint customer_line_identities_customer_channel_uidx unique (organization_id, customer_id, line_channel_id),
  constraint customer_line_identities_customer_fk foreign key (organization_id, customer_id)
    references public.customers (organization_id, id) on delete restrict,
  constraint customer_line_identities_channel_fk foreign key (organization_id, line_channel_id)
    references public.line_channels (organization_id, id) on delete restrict,
  constraint customer_line_identities_line_user_length_chk check (char_length(line_user_id) between 1 and 255),
  constraint customer_line_identities_display_name_length_chk check (display_name is null or char_length(display_name) <= 120),
  constraint customer_line_identities_friend_status_chk check (friend_status in ('unknown', 'friend', 'blocked', 'unfollowed'))
);

create index customer_line_identities_customer_idx
  on public.customer_line_identities (organization_id, customer_id, id);

create table public.locations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  customer_id uuid not null,
  label text not null default '主要地址',
  contact_name text,
  contact_phone text,
  postal_code text,
  county text,
  district text,
  address_line text not null,
  latitude numeric(9,6),
  longitude numeric(9,6),
  access_notes text not null default '',
  is_default boolean not null default false,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  lock_version integer not null default 1,
  constraint locations_org_id_uidx unique (organization_id, id),
  constraint locations_org_id_customer_uidx unique (organization_id, id, customer_id),
  constraint locations_customer_fk foreign key (organization_id, customer_id)
    references public.customers (organization_id, id) on delete restrict,
  constraint locations_label_length_chk check (char_length(label) between 1 and 80),
  constraint locations_contact_name_length_chk check (contact_name is null or char_length(contact_name) <= 120),
  constraint locations_contact_phone_format_chk check (contact_phone is null or contact_phone ~ '^\+[1-9][0-9]{7,14}$'),
  constraint locations_postal_code_length_chk check (postal_code is null or char_length(postal_code) <= 12),
  constraint locations_county_length_chk check (county is null or char_length(county) <= 80),
  constraint locations_district_length_chk check (district is null or char_length(district) <= 80),
  constraint locations_address_length_chk check (char_length(address_line) between 1 and 300),
  constraint locations_latitude_chk check (latitude is null or latitude between -90 and 90),
  constraint locations_longitude_chk check (longitude is null or longitude between -180 and 180),
  constraint locations_access_notes_length_chk check (char_length(access_notes) <= 2000),
  constraint locations_lock_version_chk check (lock_version > 0)
);

create unique index locations_one_default_per_customer_uidx
  on public.locations (organization_id, customer_id)
  where is_default and deleted_at is null;
create index locations_customer_active_idx on public.locations (organization_id, customer_id, id) where deleted_at is null;

create table public.assets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  location_id uuid not null,
  customer_id uuid not null,
  asset_no text not null,
  asset_type text not null,
  name text not null,
  brand text,
  model text,
  serial_number text,
  installed_on date,
  warranty_expires_on date,
  last_serviced_at timestamptz,
  status text not null default 'active',
  attributes jsonb not null default '{}'::jsonb,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  lock_version integer not null default 1,
  constraint assets_org_id_uidx unique (organization_id, id),
  constraint assets_org_id_customer_location_uidx unique (organization_id, id, customer_id, location_id),
  constraint assets_org_no_uidx unique (organization_id, asset_no),
  constraint assets_location_customer_fk foreign key (organization_id, location_id, customer_id)
    references public.locations (organization_id, id, customer_id) on delete restrict,
  constraint assets_type_chk check (asset_type in ('air_conditioner', 'water_heater', 'pump', 'appliance', 'other')),
  constraint assets_name_length_chk check (char_length(name) between 1 and 160),
  constraint assets_brand_length_chk check (brand is null or char_length(brand) <= 120),
  constraint assets_model_length_chk check (model is null or char_length(model) <= 120),
  constraint assets_serial_length_chk check (serial_number is null or char_length(serial_number) <= 120),
  constraint assets_status_chk check (status in ('active', 'inactive', 'retired')),
  constraint assets_attributes_size_chk check (octet_length(attributes::text) <= 32768),
  constraint assets_lock_version_chk check (lock_version > 0)
);

create index assets_location_status_idx on public.assets (organization_id, location_id, status, id);
create index assets_customer_status_idx on public.assets (organization_id, customer_id, status, id);
create index assets_serial_idx on public.assets (organization_id, serial_number, id) where serial_number is not null;

create table public.checklist_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  name text not null,
  description text not null default '',
  industry_template text not null default 'general_field_service',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  lock_version integer not null default 1,
  constraint checklist_templates_org_id_uidx unique (organization_id, id),
  constraint checklist_templates_name_length_chk check (char_length(name) between 1 and 120),
  constraint checklist_templates_description_length_chk check (char_length(description) <= 5000),
  constraint checklist_templates_industry_chk check (
    industry_template in ('general_field_service', 'cooling', 'plumbing', 'waterproofing', 'renovation')
  ),
  constraint checklist_templates_lock_version_chk check (lock_version > 0)
);

create index checklist_templates_active_name_idx
  on public.checklist_templates (organization_id, is_active, name, id);

create table public.checklist_template_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  checklist_template_id uuid not null,
  label text not null,
  description text not null default '',
  response_type text not null,
  is_required boolean not null default false,
  evidence_required boolean not null default false,
  options jsonb not null default '[]'::jsonb,
  sort_order integer not null,
  created_at timestamptz not null default now(),
  constraint checklist_template_items_org_id_uidx unique (organization_id, id),
  constraint checklist_template_items_template_sort_uidx unique (organization_id, checklist_template_id, sort_order),
  constraint checklist_template_items_template_fk foreign key (organization_id, checklist_template_id)
    references public.checklist_templates (organization_id, id) on delete restrict,
  constraint checklist_template_items_label_length_chk check (char_length(label) between 1 and 300),
  constraint checklist_template_items_description_length_chk check (char_length(description) <= 2000),
  constraint checklist_template_items_response_type_chk check (
    response_type in ('boolean', 'text', 'number', 'single_choice', 'multi_choice', 'photo')
  ),
  constraint checklist_template_items_options_size_chk check (octet_length(options::text) <= 16384),
  constraint checklist_template_items_options_shape_chk check (
    (response_type in ('single_choice', 'multi_choice') and jsonb_typeof(options) = 'array')
    or (response_type not in ('single_choice', 'multi_choice') and options = '[]'::jsonb)
  ),
  constraint checklist_template_items_sort_order_chk check (sort_order >= 0)
);

create index checklist_template_items_template_idx
  on public.checklist_template_items (organization_id, checklist_template_id, sort_order);

create table public.service_catalogs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  name text not null,
  description text not null default '',
  industry_template text not null default 'general_field_service',
  is_default boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  lock_version integer not null default 1,
  constraint service_catalogs_org_id_uidx unique (organization_id, id),
  constraint service_catalogs_name_length_chk check (char_length(name) between 1 and 120),
  constraint service_catalogs_description_length_chk check (char_length(description) <= 5000),
  constraint service_catalogs_industry_chk check (
    industry_template in ('general_field_service', 'cooling', 'plumbing', 'waterproofing', 'renovation')
  ),
  constraint service_catalogs_lock_version_chk check (lock_version > 0)
);

create unique index service_catalogs_one_default_uidx
  on public.service_catalogs (organization_id)
  where is_default and is_active;
create index service_catalogs_active_name_idx on public.service_catalogs (organization_id, is_active, name, id);

create table public.service_catalog_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  service_catalog_id uuid not null,
  code text,
  category text not null,
  name text not null,
  description text not null default '',
  specification text not null default '',
  unit text not null default '式',
  default_cost_minor bigint not null default 0,
  default_price_minor bigint not null default 0,
  tax_rate numeric(7,4) not null default 0,
  checklist_template_id uuid,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  lock_version integer not null default 1,
  constraint service_catalog_items_org_id_uidx unique (organization_id, id),
  constraint service_catalog_items_catalog_fk foreign key (organization_id, service_catalog_id)
    references public.service_catalogs (organization_id, id) on delete restrict,
  constraint service_catalog_items_checklist_fk foreign key (organization_id, checklist_template_id)
    references public.checklist_templates (organization_id, id) on delete restrict,
  constraint service_catalog_items_code_length_chk check (code is null or char_length(code) <= 60),
  constraint service_catalog_items_category_length_chk check (char_length(category) between 1 and 120),
  constraint service_catalog_items_name_length_chk check (char_length(name) between 1 and 120),
  constraint service_catalog_items_description_length_chk check (char_length(description) <= 5000),
  constraint service_catalog_items_specification_length_chk check (char_length(specification) <= 5000),
  constraint service_catalog_items_unit_length_chk check (char_length(unit) between 1 and 20),
  constraint service_catalog_items_cost_chk check (default_cost_minor >= 0),
  constraint service_catalog_items_price_chk check (default_price_minor >= 0),
  constraint service_catalog_items_tax_rate_chk check (tax_rate between 0 and 1),
  constraint service_catalog_items_metadata_size_chk check (octet_length(metadata::text) <= 16384),
  constraint service_catalog_items_lock_version_chk check (lock_version > 0)
);

create unique index service_catalog_items_code_uidx
  on public.service_catalog_items (organization_id, service_catalog_id, code)
  where code is not null;
create index service_catalog_items_catalog_active_idx
  on public.service_catalog_items (organization_id, service_catalog_id, is_active, sort_order, id);
create index service_catalog_items_checklist_idx
  on public.service_catalog_items (organization_id, checklist_template_id)
  where checklist_template_id is not null;

create table public.service_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  request_no text not null,
  customer_id uuid,
  location_id uuid,
  asset_id uuid,
  source text not null default 'manual',
  source_reference text,
  contact_name text not null,
  contact_phone text,
  contact_email text,
  customer_line_identity_id uuid,
  subject text not null,
  description text not null default '',
  priority text not null default 'normal',
  status text not null default 'new',
  assigned_member_id uuid,
  triaged_at timestamptz,
  quoted_at timestamptz,
  converted_at timestamptz,
  closed_at timestamptz,
  decline_reason text,
  cancellation_reason text,
  converted_project_id uuid,
  converted_work_order_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  lock_version integer not null default 1,
  constraint service_requests_org_id_uidx unique (organization_id, id),
  constraint service_requests_org_id_customer_location_uidx unique (organization_id, id, customer_id, location_id),
  constraint service_requests_org_no_uidx unique (organization_id, request_no),
  constraint service_requests_customer_fk foreign key (organization_id, customer_id)
    references public.customers (organization_id, id) on delete restrict,
  constraint service_requests_location_fk foreign key (organization_id, location_id)
    references public.locations (organization_id, id) on delete restrict,
  constraint service_requests_location_customer_fk foreign key (organization_id, location_id, customer_id)
    references public.locations (organization_id, id, customer_id) on delete restrict,
  constraint service_requests_asset_fk foreign key (organization_id, asset_id)
    references public.assets (organization_id, id) on delete restrict,
  constraint service_requests_asset_scope_fk foreign key (organization_id, asset_id, customer_id, location_id)
    references public.assets (organization_id, id, customer_id, location_id) on delete restrict,
  constraint service_requests_line_identity_fk foreign key (organization_id, customer_line_identity_id)
    references public.customer_line_identities (organization_id, id) on delete restrict,
  constraint service_requests_line_identity_customer_fk foreign key (
    organization_id, customer_line_identity_id, customer_id
  ) references public.customer_line_identities (organization_id, id, customer_id) on delete restrict,
  constraint service_requests_assigned_member_fk foreign key (organization_id, assigned_member_id)
    references public.memberships (organization_id, id) on delete restrict,
  constraint service_requests_source_chk check (source in ('line', 'phone', 'web', 'referral', 'manual')),
  constraint service_requests_contact_name_length_chk check (char_length(contact_name) between 1 and 120),
  constraint service_requests_contact_phone_format_chk check (contact_phone is null or contact_phone ~ '^\+[1-9][0-9]{7,14}$'),
  constraint service_requests_contact_email_chk check (
    contact_email is null or (
      contact_email = lower(contact_email) and char_length(contact_email) <= 254 and position('@' in contact_email) > 1
    )
  ),
  constraint service_requests_contact_method_chk check (
    contact_phone is not null or contact_email is not null or customer_line_identity_id is not null
  ),
  constraint service_requests_subject_length_chk check (char_length(subject) between 1 and 160),
  constraint service_requests_description_length_chk check (char_length(description) <= 10000),
  constraint service_requests_priority_chk check (priority in ('low', 'normal', 'high', 'urgent')),
  constraint service_requests_status_chk check (
    status in ('new', 'triaged', 'quoting', 'quoted', 'converted', 'declined', 'cancelled')
  ),
  constraint service_requests_close_reason_chk check (
    (status <> 'declined' or nullif(btrim(decline_reason), '') is not null)
    and (status <> 'cancelled' or nullif(btrim(cancellation_reason), '') is not null)
  ),
  constraint service_requests_description_metadata_chk check (octet_length(metadata::text) <= 32768),
  constraint service_requests_lock_version_chk check (lock_version > 0)
);

create index service_requests_status_created_idx
  on public.service_requests (organization_id, status, created_at desc, id desc);
create index service_requests_assignee_status_idx
  on public.service_requests (organization_id, assigned_member_id, status, id)
  where assigned_member_id is not null;
create unique index service_requests_source_reference_uidx
  on public.service_requests (organization_id, source, source_reference)
  where source_reference is not null;
create index service_requests_customer_idx on public.service_requests (organization_id, customer_id, created_at desc, id desc);
create index service_requests_location_idx on public.service_requests (organization_id, location_id) where location_id is not null;
create index service_requests_asset_idx on public.service_requests (organization_id, asset_id) where asset_id is not null;

create table public.service_request_time_windows (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  service_request_id uuid not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  preference_rank smallint not null,
  created_at timestamptz not null default now(),
  constraint service_request_time_windows_org_id_uidx unique (organization_id, id),
  constraint service_request_time_windows_request_rank_uidx unique (
    organization_id, service_request_id, preference_rank
  ),
  constraint service_request_time_windows_request_fk foreign key (organization_id, service_request_id)
    references public.service_requests (organization_id, id) on delete restrict,
  constraint service_request_time_windows_time_chk check (ends_at > starts_at),
  constraint service_request_time_windows_rank_chk check (preference_rank between 1 and 5)
);

create index service_request_time_windows_request_idx
  on public.service_request_time_windows (organization_id, service_request_id, preference_rank);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  project_no text not null,
  customer_id uuid not null,
  location_id uuid not null,
  service_request_id uuid,
  name text not null,
  description text not null default '',
  status text not null default 'draft',
  owner_member_id uuid,
  planned_start_on date,
  planned_end_on date,
  actual_started_at timestamptz,
  completed_at timestamptz,
  contracted_amount_minor bigint not null default 0,
  currency text not null default 'TWD',
  cancellation_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  lock_version integer not null default 1,
  constraint projects_org_id_uidx unique (organization_id, id),
  constraint projects_org_id_customer_uidx unique (organization_id, id, customer_id),
  constraint projects_org_id_customer_location_uidx unique (organization_id, id, customer_id, location_id),
  constraint projects_org_no_uidx unique (organization_id, project_no),
  constraint projects_location_customer_fk foreign key (organization_id, location_id, customer_id)
    references public.locations (organization_id, id, customer_id) on delete restrict,
  constraint projects_service_request_fk foreign key (organization_id, service_request_id)
    references public.service_requests (organization_id, id) on delete restrict,
  constraint projects_owner_member_fk foreign key (organization_id, owner_member_id)
    references public.memberships (organization_id, id) on delete restrict,
  constraint projects_name_length_chk check (char_length(name) between 1 and 160),
  constraint projects_description_length_chk check (char_length(description) <= 10000),
  constraint projects_status_chk check (status in ('draft', 'active', 'on_hold', 'completed', 'cancelled')),
  constraint projects_dates_chk check (
    planned_end_on is null or planned_start_on is null or planned_end_on >= planned_start_on
  ),
  constraint projects_amount_chk check (contracted_amount_minor >= 0),
  constraint projects_currency_chk check (currency ~ '^[A-Z]{3}$'),
  constraint projects_cancel_reason_chk check (
    status <> 'cancelled' or nullif(btrim(cancellation_reason), '') is not null
  ),
  constraint projects_lock_version_chk check (lock_version > 0)
);

create index projects_status_updated_idx on public.projects (organization_id, status, updated_at desc, id desc);
create index projects_customer_created_idx on public.projects (organization_id, customer_id, created_at desc, id desc);
create index projects_owner_status_idx on public.projects (organization_id, owner_member_id, status, id) where owner_member_id is not null;
create index projects_service_request_idx on public.projects (organization_id, service_request_id) where service_request_id is not null;
