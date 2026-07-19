-- Renoly v2 operational records, financial snapshots, field evidence and outboxes.

create table public.work_orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  work_order_no text not null,
  project_id uuid,
  service_request_id uuid,
  customer_id uuid not null,
  location_id uuid not null,
  asset_id uuid,
  service_catalog_item_id uuid,
  title text not null,
  description text not null default '',
  customer_notes text not null default '',
  technician_notes text not null default '',
  internal_notes text not null default '',
  completion_summary text,
  priority text not null default 'normal',
  status text not null default 'draft',
  scheduled_start_at timestamptz,
  scheduled_end_at timestamptz,
  dispatched_at timestamptz,
  en_route_at timestamptz,
  on_site_at timestamptz,
  paused_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  cancellation_reason text,
  accepted_quote_version_id uuid,
  requires_customer_signoff boolean not null default false,
  customer_signed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  lock_version integer not null default 1,
  constraint work_orders_org_id_uidx unique (organization_id, id),
  constraint work_orders_org_no_uidx unique (organization_id, work_order_no),
  constraint work_orders_project_scope_fk foreign key (organization_id, project_id, customer_id, location_id)
    references public.projects (organization_id, id, customer_id, location_id) on delete restrict,
  constraint work_orders_service_request_fk foreign key (organization_id, service_request_id)
    references public.service_requests (organization_id, id) on delete restrict,
  constraint work_orders_location_customer_fk foreign key (organization_id, location_id, customer_id)
    references public.locations (organization_id, id, customer_id) on delete restrict,
  constraint work_orders_asset_scope_fk foreign key (organization_id, asset_id, customer_id, location_id)
    references public.assets (organization_id, id, customer_id, location_id) on delete restrict,
  constraint work_orders_catalog_item_fk foreign key (organization_id, service_catalog_item_id)
    references public.service_catalog_items (organization_id, id) on delete restrict,
  constraint work_orders_title_length_chk check (char_length(title) between 1 and 160),
  constraint work_orders_description_length_chk check (char_length(description) <= 5000),
  constraint work_orders_customer_notes_length_chk check (char_length(customer_notes) <= 2000),
  constraint work_orders_technician_notes_length_chk check (char_length(technician_notes) <= 5000),
  constraint work_orders_internal_notes_length_chk check (char_length(internal_notes) <= 10000),
  constraint work_orders_completion_summary_length_chk check (
    completion_summary is null or char_length(completion_summary) <= 10000
  ),
  constraint work_orders_priority_chk check (priority in ('low', 'normal', 'high', 'urgent')),
  constraint work_orders_status_chk check (
    status in ('draft', 'scheduled', 'dispatched', 'en_route', 'on_site', 'paused', 'completed', 'cancelled')
  ),
  constraint work_orders_schedule_chk check (
    (scheduled_start_at is null and scheduled_end_at is null)
    or (scheduled_start_at is not null and scheduled_end_at is not null and scheduled_end_at > scheduled_start_at)
  ),
  constraint work_orders_scheduled_fields_chk check (
    status = 'draft' or status = 'cancelled' or (scheduled_start_at is not null and scheduled_end_at is not null)
  ),
  constraint work_orders_cancel_reason_chk check (
    status <> 'cancelled' or nullif(btrim(cancellation_reason), '') is not null
  ),
  constraint work_orders_completion_fields_chk check (
    status <> 'completed' or (
      completed_at is not null and nullif(btrim(completion_summary), '') is not null
      and (not requires_customer_signoff or customer_signed_at is not null)
    )
  ),
  constraint work_orders_lock_version_chk check (lock_version > 0)
);

create index work_orders_status_schedule_idx
  on public.work_orders (organization_id, status, scheduled_start_at, id);
create index work_orders_project_schedule_idx
  on public.work_orders (organization_id, project_id, scheduled_start_at, id)
  where project_id is not null;
create index work_orders_request_idx
  on public.work_orders (organization_id, service_request_id, created_at desc, id desc)
  where service_request_id is not null;
create index work_orders_customer_created_idx
  on public.work_orders (organization_id, customer_id, created_at desc, id desc);
create index work_orders_asset_completed_idx
  on public.work_orders (organization_id, asset_id, completed_at desc, id desc)
  where asset_id is not null;
create index work_orders_active_schedule_idx
  on public.work_orders (organization_id, scheduled_start_at, id)
  where status in ('scheduled', 'dispatched', 'en_route', 'on_site');

create table public.assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  work_order_id uuid not null,
  membership_id uuid not null,
  duty text not null default 'technician',
  status text not null default 'assigned',
  assigned_at timestamptz not null default now(),
  accepted_at timestamptz,
  declined_at timestamptz,
  checked_in_at timestamptz,
  checked_out_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  decline_reason text,
  assigned_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  lock_version integer not null default 1,
  constraint assignments_org_id_uidx unique (organization_id, id),
  constraint assignments_work_order_member_uidx unique (organization_id, work_order_id, membership_id),
  constraint assignments_work_order_fk foreign key (organization_id, work_order_id)
    references public.work_orders (organization_id, id) on delete restrict,
  constraint assignments_membership_fk foreign key (organization_id, membership_id)
    references public.memberships (organization_id, id) on delete restrict,
  constraint assignments_duty_chk check (duty in ('lead', 'technician', 'helper', 'observer')),
  constraint assignments_status_chk check (
    status in ('assigned', 'accepted', 'declined', 'checked_in', 'completed', 'cancelled')
  ),
  constraint assignments_decline_reason_chk check (
    status <> 'declined' or nullif(btrim(decline_reason), '') is not null
  ),
  constraint assignments_lock_version_chk check (lock_version > 0)
);

create unique index assignments_one_active_lead_uidx
  on public.assignments (organization_id, work_order_id)
  where duty = 'lead' and status not in ('declined', 'cancelled');
create index assignments_member_status_idx
  on public.assignments (organization_id, membership_id, status, work_order_id);
create index assignments_work_order_status_idx
  on public.assignments (organization_id, work_order_id, status, membership_id);

create table public.work_order_checklists (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  work_order_id uuid not null,
  source_template_id uuid,
  name text not null,
  status text not null default 'pending',
  completed_at timestamptz,
  completed_by_membership_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  lock_version integer not null default 1,
  constraint work_order_checklists_org_id_uidx unique (organization_id, id),
  constraint work_order_checklists_org_id_work_order_uidx unique (organization_id, id, work_order_id),
  constraint work_order_checklists_work_order_fk foreign key (organization_id, work_order_id)
    references public.work_orders (organization_id, id) on delete restrict,
  constraint work_order_checklists_template_fk foreign key (organization_id, source_template_id)
    references public.checklist_templates (organization_id, id) on delete restrict,
  constraint work_order_checklists_completed_member_fk foreign key (organization_id, completed_by_membership_id)
    references public.memberships (organization_id, id) on delete restrict,
  constraint work_order_checklists_name_length_chk check (char_length(name) between 1 and 120),
  constraint work_order_checklists_status_chk check (status in ('pending', 'in_progress', 'completed', 'reopened')),
  constraint work_order_checklists_completed_chk check (
    status <> 'completed' or (completed_at is not null and completed_by_membership_id is not null)
  ),
  constraint work_order_checklists_lock_version_chk check (lock_version > 0)
);

create index work_order_checklists_work_order_status_idx
  on public.work_order_checklists (organization_id, work_order_id, status, id);

create table public.work_order_checklist_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  work_order_checklist_id uuid not null,
  work_order_id uuid not null,
  source_template_item_id uuid,
  label text not null,
  response_type text not null,
  is_required boolean not null default false,
  evidence_required boolean not null default false,
  options jsonb not null default '[]'::jsonb,
  response jsonb,
  completed_at timestamptz,
  completed_by_membership_id uuid,
  sort_order integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint work_order_checklist_items_org_id_uidx unique (organization_id, id),
  constraint work_order_checklist_items_org_id_work_order_uidx unique (organization_id, id, work_order_id),
  constraint work_order_checklist_items_checklist_sort_uidx unique (
    organization_id, work_order_checklist_id, sort_order
  ),
  constraint work_order_checklist_items_checklist_fk foreign key (
    organization_id, work_order_checklist_id, work_order_id
  ) references public.work_order_checklists (organization_id, id, work_order_id) on delete restrict,
  constraint work_order_checklist_items_template_item_fk foreign key (organization_id, source_template_item_id)
    references public.checklist_template_items (organization_id, id) on delete restrict,
  constraint work_order_checklist_items_completed_member_fk foreign key (organization_id, completed_by_membership_id)
    references public.memberships (organization_id, id) on delete restrict,
  constraint work_order_checklist_items_label_length_chk check (char_length(label) between 1 and 300),
  constraint work_order_checklist_items_response_type_chk check (
    response_type in ('boolean', 'text', 'number', 'single_choice', 'multi_choice', 'photo')
  ),
  constraint work_order_checklist_items_options_size_chk check (octet_length(options::text) <= 16384),
  constraint work_order_checklist_items_response_size_chk check (
    response is null or octet_length(response::text) <= 16384
  ),
  constraint work_order_checklist_items_completion_chk check (
    (response is null and completed_at is null and completed_by_membership_id is null)
    or (response is not null and completed_at is not null and completed_by_membership_id is not null)
  ),
  constraint work_order_checklist_items_sort_order_chk check (sort_order >= 0)
);

create index work_order_checklist_items_checklist_idx
  on public.work_order_checklist_items (organization_id, work_order_checklist_id, sort_order);
create index work_order_checklist_items_work_order_idx
  on public.work_order_checklist_items (organization_id, work_order_id, is_required, id);

create table public.quotes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  quote_no text not null,
  service_request_id uuid,
  project_id uuid,
  customer_id uuid not null,
  location_id uuid not null,
  status text not null default 'draft',
  latest_version_id uuid,
  active_version_id uuid,
  accepted_version_id uuid,
  sent_at timestamptz,
  first_viewed_at timestamptz,
  accepted_at timestamptz,
  rejected_at timestamptz,
  expires_at timestamptz,
  cancelled_at timestamptz,
  rejection_reason text,
  cancellation_reason text,
  currency text not null default 'TWD',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  lock_version integer not null default 1,
  constraint quotes_org_id_uidx unique (organization_id, id),
  constraint quotes_org_no_uidx unique (organization_id, quote_no),
  constraint quotes_request_fk foreign key (organization_id, service_request_id)
    references public.service_requests (organization_id, id) on delete restrict,
  constraint quotes_project_fk foreign key (organization_id, project_id)
    references public.projects (organization_id, id) on delete restrict,
  constraint quotes_location_customer_fk foreign key (organization_id, location_id, customer_id)
    references public.locations (organization_id, id, customer_id) on delete restrict,
  constraint quotes_status_chk check (status in ('draft', 'sent', 'viewed', 'accepted', 'rejected', 'expired', 'cancelled')),
  constraint quotes_currency_chk check (currency ~ '^[A-Z]{3}$'),
  constraint quotes_rejection_reason_chk check (
    status <> 'rejected' or nullif(btrim(rejection_reason), '') is not null
  ),
  constraint quotes_cancellation_reason_chk check (
    status <> 'cancelled' or nullif(btrim(cancellation_reason), '') is not null
  ),
  constraint quotes_lock_version_chk check (lock_version > 0)
);

create index quotes_status_updated_idx on public.quotes (organization_id, status, updated_at desc, id desc);
create index quotes_customer_created_idx on public.quotes (organization_id, customer_id, created_at desc, id desc);
create index quotes_request_idx on public.quotes (organization_id, service_request_id, created_at desc) where service_request_id is not null;
create index quotes_project_idx on public.quotes (organization_id, project_id, created_at desc) where project_id is not null;

create table public.quote_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  quote_id uuid not null,
  version_no integer not null,
  status text not null default 'draft',
  approval_status text not null default 'not_submitted',
  submitted_for_approval_at timestamptz,
  submitted_for_approval_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  approved_by uuid references auth.users(id) on delete set null,
  approval_rejection_reason text,
  title text not null,
  customer_notes text not null default '',
  internal_notes text not null default '',
  terms text not null default '',
  subtotal_minor bigint not null default 0,
  discount_minor bigint not null default 0,
  tax_minor bigint not null default 0,
  total_minor bigint not null default 0,
  valid_until date,
  sent_at timestamptz,
  accepted_at timestamptz,
  rejected_at timestamptz,
  created_from_version_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  lock_version integer not null default 1,
  constraint quote_versions_org_id_uidx unique (organization_id, id),
  constraint quote_versions_org_id_quote_uidx unique (organization_id, id, quote_id),
  constraint quote_versions_quote_version_uidx unique (organization_id, quote_id, version_no),
  constraint quote_versions_quote_fk foreign key (organization_id, quote_id)
    references public.quotes (organization_id, id) on delete restrict,
  constraint quote_versions_created_from_fk foreign key (organization_id, created_from_version_id)
    references public.quote_versions (organization_id, id) on delete restrict,
  constraint quote_versions_version_no_chk check (version_no >= 1),
  constraint quote_versions_status_chk check (
    status in ('draft', 'sent', 'superseded', 'accepted', 'rejected', 'expired', 'cancelled')
  ),
  constraint quote_versions_approval_status_chk check (
    approval_status in ('not_submitted', 'pending', 'approved', 'changes_requested')
  ),
  constraint quote_versions_approval_lifecycle_chk check (
    (approval_status <> 'pending' or (submitted_for_approval_at is not null and submitted_for_approval_by is not null))
    and (approval_status <> 'approved' or (approved_at is not null and approved_by is not null))
    and (approval_status <> 'changes_requested' or nullif(btrim(approval_rejection_reason), '') is not null)
    and (status = 'draft' or approval_status = 'approved')
  ),
  constraint quote_versions_title_length_chk check (char_length(title) between 1 and 160),
  constraint quote_versions_customer_notes_length_chk check (char_length(customer_notes) <= 10000),
  constraint quote_versions_internal_notes_length_chk check (char_length(internal_notes) <= 10000),
  constraint quote_versions_terms_length_chk check (char_length(terms) <= 10000),
  constraint quote_versions_money_nonnegative_chk check (
    subtotal_minor >= 0 and discount_minor >= 0 and tax_minor >= 0 and total_minor >= 0
  ),
  constraint quote_versions_total_chk check (total_minor = subtotal_minor - discount_minor + tax_minor),
  constraint quote_versions_discount_chk check (discount_minor <= subtotal_minor),
  constraint quote_versions_lock_version_chk check (lock_version > 0)
);

create index quote_versions_quote_version_idx
  on public.quote_versions (organization_id, quote_id, version_no desc, id);
create index quote_versions_approval_idx
  on public.quote_versions (organization_id, approval_status, updated_at, id)
  where status = 'draft';

create table public.quote_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  quote_version_id uuid not null,
  service_catalog_item_id uuid,
  group_name text not null default '',
  name text not null,
  specification text not null default '',
  unit text not null default '式',
  quantity numeric(12,3) not null,
  unit_cost_minor bigint not null default 0,
  unit_price_minor bigint not null,
  discount_minor bigint not null default 0,
  tax_rate numeric(7,4) not null default 0,
  subtotal_minor bigint not null,
  tax_minor bigint not null,
  total_minor bigint not null,
  sort_order integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint quote_items_org_id_uidx unique (organization_id, id),
  constraint quote_items_version_sort_uidx unique (organization_id, quote_version_id, sort_order),
  constraint quote_items_version_fk foreign key (organization_id, quote_version_id)
    references public.quote_versions (organization_id, id) on delete restrict,
  constraint quote_items_catalog_item_fk foreign key (organization_id, service_catalog_item_id)
    references public.service_catalog_items (organization_id, id) on delete restrict,
  constraint quote_items_group_length_chk check (char_length(group_name) <= 120),
  constraint quote_items_name_length_chk check (char_length(name) between 1 and 300),
  constraint quote_items_specification_length_chk check (char_length(specification) <= 5000),
  constraint quote_items_unit_length_chk check (char_length(unit) between 1 and 20),
  constraint quote_items_quantity_chk check (quantity > 0),
  constraint quote_items_money_chk check (
    unit_cost_minor >= 0 and unit_price_minor >= 0 and discount_minor >= 0
    and subtotal_minor >= 0 and tax_minor >= 0 and total_minor >= 0
  ),
  constraint quote_items_tax_rate_chk check (tax_rate between 0 and 1),
  constraint quote_items_total_chk check (total_minor = subtotal_minor - discount_minor + tax_minor),
  constraint quote_items_discount_chk check (discount_minor <= subtotal_minor),
  constraint quote_items_sort_order_chk check (sort_order >= 0)
);

create index quote_items_version_idx on public.quote_items (organization_id, quote_version_id, sort_order, id);
create index quote_items_catalog_item_idx on public.quote_items (organization_id, service_catalog_item_id) where service_catalog_item_id is not null;

alter table public.quotes
  add constraint quotes_latest_version_fk foreign key (organization_id, latest_version_id, id)
    references public.quote_versions (organization_id, id, quote_id) on delete restrict deferrable initially deferred,
  add constraint quotes_active_version_fk foreign key (organization_id, active_version_id, id)
    references public.quote_versions (organization_id, id, quote_id) on delete restrict deferrable initially deferred,
  add constraint quotes_accepted_version_fk foreign key (organization_id, accepted_version_id, id)
    references public.quote_versions (organization_id, id, quote_id) on delete restrict deferrable initially deferred;

alter table public.work_orders
  add constraint work_orders_accepted_quote_version_fk foreign key (organization_id, accepted_quote_version_id)
    references public.quote_versions (organization_id, id) on delete restrict;

create index work_orders_accepted_quote_idx
  on public.work_orders (organization_id, accepted_quote_version_id)
  where accepted_quote_version_id is not null;

create table public.change_orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  change_order_no text not null,
  project_id uuid not null,
  work_order_id uuid,
  customer_id uuid not null,
  title text not null,
  reason text not null,
  kind text not null default 'addition',
  status text not null default 'draft',
  subtotal_minor bigint not null default 0,
  tax_minor bigint not null default 0,
  total_minor bigint not null default 0,
  currency text not null default 'TWD',
  sent_at timestamptz,
  accepted_at timestamptz,
  rejected_at timestamptz,
  cancelled_at timestamptz,
  rejection_reason text,
  cancellation_reason text,
  customer_signed_name text,
  customer_signed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  lock_version integer not null default 1,
  constraint change_orders_org_id_uidx unique (organization_id, id),
  constraint change_orders_org_no_uidx unique (organization_id, change_order_no),
  constraint change_orders_project_customer_fk foreign key (organization_id, project_id, customer_id)
    references public.projects (organization_id, id, customer_id) on delete restrict,
  constraint change_orders_work_order_fk foreign key (organization_id, work_order_id)
    references public.work_orders (organization_id, id) on delete restrict,
  constraint change_orders_title_length_chk check (char_length(title) between 1 and 160),
  constraint change_orders_reason_length_chk check (char_length(reason) between 1 and 5000),
  constraint change_orders_kind_chk check (kind in ('addition', 'deduction')),
  constraint change_orders_status_chk check (status in ('draft', 'sent', 'accepted', 'rejected', 'cancelled')),
  constraint change_orders_money_chk check (subtotal_minor >= 0 and tax_minor >= 0 and total_minor >= 0),
  constraint change_orders_total_chk check (total_minor = subtotal_minor + tax_minor),
  constraint change_orders_currency_chk check (currency ~ '^[A-Z]{3}$'),
  constraint change_orders_rejection_reason_chk check (
    status <> 'rejected' or nullif(btrim(rejection_reason), '') is not null
  ),
  constraint change_orders_cancel_reason_chk check (
    status <> 'cancelled' or nullif(btrim(cancellation_reason), '') is not null
  ),
  constraint change_orders_signoff_chk check (
    status <> 'accepted' or (
      accepted_at is not null and customer_signed_at is not null
      and nullif(btrim(customer_signed_name), '') is not null
    )
  ),
  constraint change_orders_lock_version_chk check (lock_version > 0)
);

create index change_orders_project_status_idx
  on public.change_orders (organization_id, project_id, status, created_at desc, id desc);
create index change_orders_work_order_idx
  on public.change_orders (organization_id, work_order_id, created_at desc)
  where work_order_id is not null;

create table public.change_order_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  change_order_id uuid not null,
  service_catalog_item_id uuid,
  name text not null,
  specification text not null default '',
  unit text not null default '式',
  quantity numeric(12,3) not null,
  unit_price_minor bigint not null,
  tax_rate numeric(7,4) not null default 0,
  subtotal_minor bigint not null,
  tax_minor bigint not null,
  total_minor bigint not null,
  sort_order integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint change_order_items_org_id_uidx unique (organization_id, id),
  constraint change_order_items_order_sort_uidx unique (organization_id, change_order_id, sort_order),
  constraint change_order_items_order_fk foreign key (organization_id, change_order_id)
    references public.change_orders (organization_id, id) on delete restrict,
  constraint change_order_items_catalog_item_fk foreign key (organization_id, service_catalog_item_id)
    references public.service_catalog_items (organization_id, id) on delete restrict,
  constraint change_order_items_name_length_chk check (char_length(name) between 1 and 300),
  constraint change_order_items_specification_length_chk check (char_length(specification) <= 5000),
  constraint change_order_items_unit_length_chk check (char_length(unit) between 1 and 20),
  constraint change_order_items_quantity_chk check (quantity > 0),
  constraint change_order_items_money_chk check (
    unit_price_minor >= 0 and subtotal_minor >= 0 and tax_minor >= 0 and total_minor >= 0
  ),
  constraint change_order_items_tax_rate_chk check (tax_rate between 0 and 1),
  constraint change_order_items_total_chk check (total_minor = subtotal_minor + tax_minor),
  constraint change_order_items_sort_order_chk check (sort_order >= 0)
);

create index change_order_items_order_idx
  on public.change_order_items (organization_id, change_order_id, sort_order, id);
create index change_order_items_catalog_idx
  on public.change_order_items (organization_id, service_catalog_item_id)
  where service_catalog_item_id is not null;

create table public.payment_milestones (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  project_id uuid not null,
  quote_version_id uuid,
  change_order_id uuid,
  name text not null,
  sequence_no integer not null,
  amount_minor bigint not null,
  currency text not null default 'TWD',
  due_on date,
  status text not null default 'pending',
  invoiced_at timestamptz,
  paid_at timestamptz,
  waived_at timestamptz,
  cancelled_at timestamptz,
  payment_method text,
  external_reference text,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  lock_version integer not null default 1,
  constraint payment_milestones_org_id_uidx unique (organization_id, id),
  constraint payment_milestones_project_sequence_uidx unique (organization_id, project_id, sequence_no),
  constraint payment_milestones_project_fk foreign key (organization_id, project_id)
    references public.projects (organization_id, id) on delete restrict,
  constraint payment_milestones_quote_version_fk foreign key (organization_id, quote_version_id)
    references public.quote_versions (organization_id, id) on delete restrict,
  constraint payment_milestones_change_order_fk foreign key (organization_id, change_order_id)
    references public.change_orders (organization_id, id) on delete restrict,
  constraint payment_milestones_name_length_chk check (char_length(name) between 1 and 120),
  constraint payment_milestones_sequence_chk check (sequence_no > 0),
  constraint payment_milestones_amount_chk check (amount_minor > 0),
  constraint payment_milestones_currency_chk check (currency ~ '^[A-Z]{3}$'),
  constraint payment_milestones_status_chk check (
    status in ('pending', 'invoiced', 'overdue', 'paid', 'waived', 'cancelled')
  ),
  constraint payment_milestones_paid_chk check (status <> 'paid' or paid_at is not null),
  constraint payment_milestones_payment_method_chk check (
    payment_method is null or payment_method in ('cash', 'transfer', 'card', 'other')
  ),
  constraint payment_milestones_external_reference_length_chk check (
    external_reference is null or char_length(external_reference) <= 120
  ),
  constraint payment_milestones_notes_length_chk check (char_length(notes) <= 2000),
  constraint payment_milestones_lock_version_chk check (lock_version > 0)
);

create index payment_milestones_status_due_idx
  on public.payment_milestones (organization_id, status, due_on, id);
create index payment_milestones_project_idx
  on public.payment_milestones (organization_id, project_id, sequence_no, id);
create index payment_milestones_quote_idx
  on public.payment_milestones (organization_id, quote_version_id)
  where quote_version_id is not null;
create index payment_milestones_change_order_idx
  on public.payment_milestones (organization_id, change_order_id)
  where change_order_id is not null;

create table public.photos (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  service_request_id uuid,
  work_order_id uuid,
  checklist_item_id uuid,
  category text not null,
  status text not null default 'pending',
  storage_path text not null,
  thumbnail_path text,
  original_filename text,
  mime_type text,
  byte_size bigint,
  width integer,
  height integer,
  sha256 text,
  caption text not null default '',
  captured_at timestamptz,
  uploaded_by_membership_id uuid,
  customer_line_identity_id uuid,
  deleted_at timestamptz,
  ready_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  lock_version integer not null default 1,
  constraint photos_org_id_uidx unique (organization_id, id),
  constraint photos_storage_path_uidx unique (organization_id, storage_path),
  constraint photos_request_fk foreign key (organization_id, service_request_id)
    references public.service_requests (organization_id, id) on delete restrict,
  constraint photos_work_order_fk foreign key (organization_id, work_order_id)
    references public.work_orders (organization_id, id) on delete restrict,
  constraint photos_checklist_item_scope_fk foreign key (organization_id, checklist_item_id, work_order_id)
    references public.work_order_checklist_items (organization_id, id, work_order_id) on delete restrict,
  constraint photos_uploaded_member_fk foreign key (organization_id, uploaded_by_membership_id)
    references public.memberships (organization_id, id) on delete restrict,
  constraint photos_customer_line_identity_fk foreign key (organization_id, customer_line_identity_id)
    references public.customer_line_identities (organization_id, id) on delete restrict,
  constraint photos_one_parent_chk check (num_nonnulls(service_request_id, work_order_id) = 1),
  constraint photos_category_chk check (category in ('intake', 'before', 'after', 'issue', 'receipt', 'signature', 'other')),
  constraint photos_status_chk check (status in ('pending', 'processing', 'ready', 'quarantined', 'failed', 'deleted')),
  constraint photos_path_length_chk check (char_length(storage_path) between 1 and 1000),
  constraint photos_thumbnail_path_length_chk check (thumbnail_path is null or char_length(thumbnail_path) <= 1000),
  constraint photos_filename_length_chk check (original_filename is null or char_length(original_filename) <= 200),
  constraint photos_mime_chk check (mime_type is null or mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  constraint photos_dimensions_chk check (
    (byte_size is null or byte_size between 0 and 10485760)
    and (width is null or width between 1 and 10000)
    and (height is null or height between 1 and 10000)
    and (width is null or height is null or (width::bigint * height::bigint) <= 25000000)
  ),
  constraint photos_sha256_chk check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  constraint photos_caption_length_chk check (char_length(caption) <= 1000),
  constraint photos_ready_fields_chk check (
    status <> 'ready' or (
      ready_at is not null and mime_type is not null and byte_size is not null
      and width is not null and height is not null and sha256 is not null
    )
  ),
  constraint photos_lock_version_chk check (lock_version > 0)
);

create index photos_work_order_category_idx
  on public.photos (organization_id, work_order_id, category, created_at, id)
  where work_order_id is not null and deleted_at is null;
create index photos_request_created_idx
  on public.photos (organization_id, service_request_id, created_at, id)
  where service_request_id is not null and deleted_at is null;
create index photos_processing_queue_idx
  on public.photos (status, created_at, id)
  where status in ('pending', 'processing');
create index photos_checklist_item_idx
  on public.photos (organization_id, checklist_item_id, status)
  where checklist_item_id is not null;

create table public.maintenance_plans (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  customer_id uuid not null,
  location_id uuid not null,
  asset_id uuid,
  service_catalog_item_id uuid,
  name text not null,
  cadence_months smallint not null,
  lead_days smallint not null default 14,
  next_due_on date not null,
  last_completed_work_order_id uuid,
  status text not null default 'active',
  auto_prepare_message boolean not null default true,
  paused_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  lock_version integer not null default 1,
  constraint maintenance_plans_org_id_uidx unique (organization_id, id),
  constraint maintenance_plans_location_customer_fk foreign key (organization_id, location_id, customer_id)
    references public.locations (organization_id, id, customer_id) on delete restrict,
  constraint maintenance_plans_asset_scope_fk foreign key (organization_id, asset_id, customer_id, location_id)
    references public.assets (organization_id, id, customer_id, location_id) on delete restrict,
  constraint maintenance_plans_catalog_item_fk foreign key (organization_id, service_catalog_item_id)
    references public.service_catalog_items (organization_id, id) on delete restrict,
  constraint maintenance_plans_last_work_order_fk foreign key (organization_id, last_completed_work_order_id)
    references public.work_orders (organization_id, id) on delete restrict,
  constraint maintenance_plans_name_length_chk check (char_length(name) between 1 and 160),
  constraint maintenance_plans_cadence_chk check (cadence_months between 1 and 60),
  constraint maintenance_plans_lead_days_chk check (lead_days between 0 and 90),
  constraint maintenance_plans_status_chk check (status in ('active', 'paused', 'completed', 'cancelled')),
  constraint maintenance_plans_lock_version_chk check (lock_version > 0)
);

create unique index maintenance_plans_one_active_asset_service_uidx
  on public.maintenance_plans (organization_id, asset_id, service_catalog_item_id)
  where status = 'active' and asset_id is not null and service_catalog_item_id is not null;
create index maintenance_plans_due_idx
  on public.maintenance_plans (organization_id, status, next_due_on, id);
create index maintenance_plans_asset_idx
  on public.maintenance_plans (organization_id, asset_id, status, id)
  where asset_id is not null;

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  channel text not null,
  line_channel_id uuid,
  customer_line_identity_id uuid,
  membership_id uuid,
  template_key text not null,
  template_version integer not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending',
  approval_status text not null default 'not_required',
  dedupe_key text not null,
  scheduled_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  attempt_count smallint not null default 0,
  max_attempts smallint not null default 5,
  next_attempt_at timestamptz,
  provider_message_id text,
  last_error_code text,
  last_error_message text,
  sent_at timestamptz,
  delivered_at timestamptz,
  failed_at timestamptz,
  cancelled_at timestamptz,
  related_type text,
  related_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notifications_org_id_uidx unique (organization_id, id),
  constraint notifications_dedupe_uidx unique (organization_id, channel, dedupe_key),
  constraint notifications_line_channel_fk foreign key (organization_id, line_channel_id)
    references public.line_channels (organization_id, id) on delete restrict,
  constraint notifications_customer_identity_fk foreign key (organization_id, customer_line_identity_id)
    references public.customer_line_identities (organization_id, id) on delete restrict,
  constraint notifications_membership_fk foreign key (organization_id, membership_id)
    references public.memberships (organization_id, id) on delete restrict,
  constraint notifications_channel_chk check (channel in ('line', 'in_app', 'email', 'sms')),
  constraint notifications_recipient_chk check (num_nonnulls(customer_line_identity_id, membership_id) = 1),
  constraint notifications_line_channel_required_chk check (channel <> 'line' or line_channel_id is not null),
  constraint notifications_template_key_length_chk check (char_length(template_key) between 1 and 120),
  constraint notifications_template_version_chk check (template_version > 0),
  constraint notifications_payload_size_chk check (octet_length(payload::text) <= 32768),
  constraint notifications_status_chk check (
    status in ('pending', 'processing', 'sent', 'delivered', 'failed', 'cancelled')
  ),
  constraint notifications_approval_status_chk check (
    approval_status in ('not_required', 'pending', 'approved', 'rejected')
  ),
  constraint notifications_dedupe_key_length_chk check (char_length(dedupe_key) between 1 and 200),
  constraint notifications_attempts_chk check (
    attempt_count between 0 and 100 and max_attempts between 1 and 100 and attempt_count <= max_attempts
  ),
  constraint notifications_related_type_chk check (
    related_type is null or related_type in ('service_request', 'quote', 'work_order', 'change_order', 'payment_milestone', 'maintenance_plan')
  ),
  constraint notifications_related_pair_chk check (num_nonnulls(related_type, related_id) in (0, 2))
);

create index notifications_claim_idx
  on public.notifications (status, approval_status, (coalesce(next_attempt_at, scheduled_at)), created_at, id)
  where status in ('pending', 'failed');
create index notifications_related_idx
  on public.notifications (organization_id, related_type, related_id, created_at desc, id desc)
  where related_type is not null;
create index notifications_membership_idx
  on public.notifications (organization_id, membership_id, created_at desc)
  where membership_id is not null;

create table public.notification_attempts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  notification_id uuid not null,
  attempt_no smallint not null,
  started_at timestamptz not null,
  finished_at timestamptz,
  outcome text not null,
  provider_status integer,
  provider_request_id text,
  error_code text,
  latency_ms integer,
  constraint notification_attempts_org_id_uidx unique (organization_id, id),
  constraint notification_attempts_notification_attempt_uidx unique (notification_id, attempt_no),
  constraint notification_attempts_notification_fk foreign key (organization_id, notification_id)
    references public.notifications (organization_id, id) on delete restrict,
  constraint notification_attempts_attempt_no_chk check (attempt_no between 1 and 100),
  constraint notification_attempts_outcome_chk check (outcome in ('sent', 'failed', 'timeout', 'cancelled')),
  constraint notification_attempts_provider_status_chk check (
    provider_status is null or provider_status between 100 and 599
  ),
  constraint notification_attempts_latency_chk check (latency_ms is null or latency_ms >= 0)
);

create index notification_attempts_notification_idx
  on public.notification_attempts (organization_id, notification_id, attempt_no);

create table public.line_webhook_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  line_channel_id uuid not null,
  webhook_event_id text,
  event_type text not null,
  event_timestamp timestamptz not null,
  payload jsonb not null,
  payload_sha256 text not null,
  status text not null default 'pending',
  attempt_count smallint not null default 0,
  next_attempt_at timestamptz,
  locked_at timestamptz,
  processed_at timestamptz,
  error_code text,
  received_at timestamptz not null default now(),
  constraint line_webhook_events_org_id_uidx unique (organization_id, id),
  constraint line_webhook_events_channel_fk foreign key (organization_id, line_channel_id)
    references public.line_channels (organization_id, id) on delete restrict,
  constraint line_webhook_events_event_id_uidx unique (line_channel_id, webhook_event_id),
  constraint line_webhook_events_event_type_length_chk check (char_length(event_type) between 1 and 120),
  constraint line_webhook_events_payload_size_chk check (octet_length(payload::text) <= 1048576),
  constraint line_webhook_events_sha256_chk check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  constraint line_webhook_events_status_chk check (status in ('pending', 'processing', 'processed', 'ignored', 'failed')),
  constraint line_webhook_events_attempt_count_chk check (attempt_count between 0 and 100)
);

create unique index line_webhook_events_fallback_uidx
  on public.line_webhook_events (line_channel_id, payload_sha256, event_timestamp)
  where webhook_event_id is null;
create index line_webhook_events_claim_idx
  on public.line_webhook_events (status, coalesce(next_attempt_at, received_at), received_at, id)
  where status in ('pending', 'failed');

create table public.public_access_tokens (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  resource_type text not null,
  resource_id uuid not null,
  token_hash bytea not null,
  scopes text[] not null,
  expires_at timestamptz not null,
  max_uses integer,
  use_count integer not null default 0,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint public_access_tokens_org_id_uidx unique (organization_id, id),
  constraint public_access_tokens_token_hash_uidx unique (token_hash),
  constraint public_access_tokens_resource_type_chk check (
    resource_type in ('intake_form', 'quote', 'change_order', 'work_order_signoff')
  ),
  constraint public_access_tokens_token_hash_size_chk check (octet_length(token_hash) = 32),
  constraint public_access_tokens_scopes_chk check (cardinality(scopes) between 1 and 10 and array_position(scopes, null) is null),
  constraint public_access_tokens_max_uses_chk check (max_uses is null or max_uses > 0),
  constraint public_access_tokens_use_count_chk check (
    use_count >= 0 and (max_uses is null or use_count <= max_uses)
  )
);

create index public_access_tokens_resource_idx
  on public.public_access_tokens (organization_id, resource_type, resource_id, revoked_at, id);

create table public.idempotency_keys (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete restrict,
  actor_fingerprint text not null,
  method text not null,
  path_template text not null,
  idempotency_key text not null,
  request_hash text not null,
  state text not null default 'processing',
  response_status integer,
  response_body jsonb,
  resource_type text,
  resource_id uuid,
  locked_until timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint idempotency_keys_org_id_uidx unique (organization_id, id),
  constraint idempotency_keys_operation_uidx unique (actor_fingerprint, method, path_template, idempotency_key),
  constraint idempotency_keys_method_chk check (method in ('POST', 'PUT', 'PATCH', 'DELETE')),
  constraint idempotency_keys_fingerprint_length_chk check (char_length(actor_fingerprint) between 1 and 200),
  constraint idempotency_keys_path_length_chk check (char_length(path_template) between 1 and 300),
  constraint idempotency_keys_key_length_chk check (char_length(idempotency_key) between 1 and 200),
  constraint idempotency_keys_request_hash_chk check (request_hash ~ '^[0-9a-f]{64}$'),
  constraint idempotency_keys_state_chk check (state in ('processing', 'completed', 'failed')),
  constraint idempotency_keys_response_status_chk check (
    response_status is null or response_status between 100 and 599
  ),
  constraint idempotency_keys_response_body_size_chk check (
    response_body is null or octet_length(response_body::text) <= 65536
  ),
  constraint idempotency_keys_resource_pair_chk check (num_nonnulls(resource_type, resource_id) in (0, 2)),
  constraint idempotency_keys_expiry_chk check (expires_at > created_at)
);

create index idempotency_keys_expiry_idx on public.idempotency_keys (expires_at, id);
create index idempotency_keys_org_resource_idx
  on public.idempotency_keys (organization_id, resource_type, resource_id)
  where resource_type is not null;

create table public.document_sequences (
  organization_id uuid not null references public.organizations(id) on delete restrict,
  document_type text not null,
  period_key text not null,
  current_value bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (organization_id, document_type, period_key),
  constraint document_sequences_document_type_chk check (
    document_type in ('customer', 'request', 'project', 'work_order', 'quote', 'change_order')
  ),
  constraint document_sequences_period_key_length_chk check (char_length(period_key) between 1 and 20),
  constraint document_sequences_current_value_chk check (current_value >= 0)
);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  aggregate_type text not null,
  aggregate_id uuid not null,
  event_type text not null,
  actor_type text not null,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_customer_id uuid,
  occurred_at timestamptz not null default now(),
  recorded_at timestamptz not null default clock_timestamp(),
  chain_sequence bigint not null default 1,
  request_id uuid not null default gen_random_uuid(),
  idempotency_key text,
  payload jsonb not null default '{}'::jsonb,
  prev_hash bytea,
  event_hash bytea not null,
  constraint events_org_id_uidx unique (organization_id, id),
  constraint events_actor_customer_fk foreign key (organization_id, actor_customer_id)
    references public.customers (organization_id, id) on delete restrict,
  constraint events_aggregate_type_chk check (
    aggregate_type in (
      'service_request', 'project', 'work_order', 'quote', 'change_order',
      'payment_milestone', 'maintenance_plan', 'line_channel'
    )
  ),
  constraint events_event_type_length_chk check (char_length(event_type) between 1 and 160),
  constraint events_actor_type_chk check (actor_type in ('user', 'customer', 'system', 'line')),
  constraint events_actor_shape_chk check (
    (actor_type = 'user' and actor_user_id is not null and actor_customer_id is null)
    or (actor_type in ('customer', 'line') and actor_user_id is null and actor_customer_id is not null)
    or (actor_type = 'system' and actor_user_id is null and actor_customer_id is null)
  ),
  constraint events_idempotency_key_length_chk check (idempotency_key is null or char_length(idempotency_key) <= 200),
  constraint events_aggregate_chain_uidx unique (
    organization_id, aggregate_type, aggregate_id, chain_sequence
  ),
  constraint events_chain_sequence_chk check (chain_sequence > 0),
  constraint events_chain_shape_chk check (
    (chain_sequence = 1 and prev_hash is null)
    or (chain_sequence > 1 and prev_hash is not null)
  ),
  constraint events_payload_size_chk check (octet_length(payload::text) <= 32768),
  constraint events_prev_hash_size_chk check (prev_hash is null or octet_length(prev_hash) = 32),
  constraint events_event_hash_size_chk check (octet_length(event_hash) = 32)
);

create index events_aggregate_timeline_idx
  on public.events (organization_id, aggregate_type, aggregate_id, occurred_at, id);
create index events_type_time_idx
  on public.events (organization_id, event_type, occurred_at desc, id desc);

create table private.line_channel_credentials (
  line_channel_id uuid primary key,
  organization_id uuid not null,
  secret_ciphertext bytea not null,
  secret_nonce bytea not null,
  access_token_ciphertext bytea not null,
  access_token_nonce bytea not null,
  key_version integer not null,
  token_expires_at timestamptz,
  rotated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint line_channel_credentials_channel_fk foreign key (organization_id, line_channel_id)
    references public.line_channels (organization_id, id) on delete restrict,
  constraint line_channel_credentials_nonce_size_chk check (
    octet_length(secret_nonce) = 12 and octet_length(access_token_nonce) = 12
  ),
  constraint line_channel_credentials_ciphertext_chk check (
    octet_length(secret_ciphertext) >= 16 and octet_length(access_token_ciphertext) >= 16
  ),
  constraint line_channel_credentials_key_version_chk check (key_version > 0)
);

alter table public.service_requests
  add constraint service_requests_converted_project_fk foreign key (organization_id, converted_project_id)
    references public.projects (organization_id, id) on delete restrict,
  add constraint service_requests_converted_work_order_fk foreign key (organization_id, converted_work_order_id)
    references public.work_orders (organization_id, id) on delete restrict,
  add constraint service_requests_conversion_result_chk check (
    status <> 'converted' or num_nonnulls(converted_project_id, converted_work_order_id) >= 1
  );

create index service_requests_converted_project_idx
  on public.service_requests (organization_id, converted_project_id)
  where converted_project_id is not null;
create index service_requests_converted_work_order_idx
  on public.service_requests (organization_id, converted_work_order_id)
  where converted_work_order_id is not null;

-- Storage remains private. The application issues short-lived signed upload/read URLs.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'work-media',
  'work-media',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;
