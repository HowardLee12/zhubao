-- Renoly v2 deterministic local/test seed. All identities and business data below
-- are synthetic. Fixed user UUIDs support pgTAP JWT-claim tests.
--
-- Auth users below are login-ready: GoTrue requires instance_id set and the token
-- columns to be '' (not NULL) or it treats the row as malformed and re-inserts,
-- tripping users_email_partial_key on OTP/magic-link. Each user also gets an email
-- identity so passwordless sign-in resolves the existing user instead of creating one.
-- SQL/RLS tests still set request.jwt.claim.sub directly.

begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, email_change_token_current,
  recovery_token, phone_change, phone_change_token, reauthentication_token
)
values
  (
    '10000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'alpha.owner@example.test', extensions.crypt('RenolyDemo-Owner-2026', extensions.gen_salt('bf')),
    '2026-01-01 00:00:00+00', '{"provider":"email","providers":["email"]}',
    '{"display_name":"Alpha Owner"}', '2026-01-01 00:00:00+00', '2026-01-01 00:00:00+00',
    '', '', '', '', '', '', '', ''
  ),
  (
    '10000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'alpha.dispatcher@example.test', extensions.crypt('RenolyDemo-Dispatcher-2026', extensions.gen_salt('bf')),
    '2026-01-01 00:00:00+00', '{"provider":"email","providers":["email"]}',
    '{"display_name":"Alpha Dispatcher"}', '2026-01-01 00:00:00+00', '2026-01-01 00:00:00+00',
    '', '', '', '', '', '', '', ''
  ),
  (
    '10000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'alpha.tech-a@example.test', extensions.crypt('RenolyDemo-TechA-2026', extensions.gen_salt('bf')),
    '2026-01-01 00:00:00+00', '{"provider":"email","providers":["email"]}',
    '{"display_name":"Alpha Tech A"}', '2026-01-01 00:00:00+00', '2026-01-01 00:00:00+00',
    '', '', '', '', '', '', '', ''
  ),
  (
    '10000000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'alpha.tech-b@example.test', extensions.crypt('RenolyDemo-TechB-2026', extensions.gen_salt('bf')),
    '2026-01-01 00:00:00+00', '{"provider":"email","providers":["email"]}',
    '{"display_name":"Alpha Tech B"}', '2026-01-01 00:00:00+00', '2026-01-01 00:00:00+00',
    '', '', '', '', '', '', '', ''
  ),
  (
    '10000000-0000-4000-8000-000000000005', '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'beta.owner@example.test', extensions.crypt('RenolyDemo-BetaOwner-2026', extensions.gen_salt('bf')),
    '2026-01-01 00:00:00+00', '{"provider":"email","providers":["email"]}',
    '{"display_name":"Beta Owner"}', '2026-01-01 00:00:00+00', '2026-01-01 00:00:00+00',
    '', '', '', '', '', '', '', ''
  )
on conflict (id) do nothing;

-- Email identity per user so GoTrue passwordless sign-in resolves the existing
-- user (provider_id = user id; identity_data carries the verified email).
insert into auth.identities (
  id, user_id, provider_id, identity_data, provider,
  last_sign_in_at, created_at, updated_at
)
select
  u.id, u.id, u.id::text,
  jsonb_build_object('sub', u.id::text, 'email', u.email,
    'email_verified', true, 'phone_verified', false),
  'email', '2026-01-01 00:00:00+00', '2026-01-01 00:00:00+00', '2026-01-01 00:00:00+00'
from auth.users u
where u.email like '%@example.test'
on conflict (provider_id, provider) do nothing;

insert into public.organizations (
  id, slug, name, industry_template, timezone, currency, status,
  created_at, updated_at, created_by, updated_by
)
values
  (
    '20000000-0000-4000-8000-000000000001', 'alpha-field-service', 'Alpha 冷氣水電（測試）',
    'cooling', 'Asia/Taipei', 'TWD', 'active',
    '2026-01-01 00:00:00+00', '2026-01-01 00:00:00+00',
    '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001'
  ),
  (
    '20000000-0000-4000-8000-000000000002', 'beta-waterproofing', 'Beta 防水工程（測試）',
    'waterproofing', 'Asia/Taipei', 'TWD', 'active',
    '2026-01-01 00:00:00+00', '2026-01-01 00:00:00+00',
    '10000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000005'
  );

insert into public.memberships (
  id, organization_id, user_id, role, status, display_name, joined_at,
  created_at, updated_at, created_by, updated_by
)
values
  (
    '30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001', 'owner', 'active', 'Alpha 老闆',
    '2026-01-01 00:00:00+00', '2026-01-01 00:00:00+00', '2026-01-01 00:00:00+00',
    '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001'
  ),
  (
    '30000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000002', 'dispatcher', 'active', 'Alpha 派工',
    '2026-01-01 00:00:00+00', '2026-01-01 00:00:00+00', '2026-01-01 00:00:00+00',
    '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001'
  ),
  (
    '30000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000003', 'technician', 'active', 'Alpha 技師 A',
    '2026-01-01 00:00:00+00', '2026-01-01 00:00:00+00', '2026-01-01 00:00:00+00',
    '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001'
  ),
  (
    '30000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000004', 'technician', 'active', 'Alpha 技師 B',
    '2026-01-01 00:00:00+00', '2026-01-01 00:00:00+00', '2026-01-01 00:00:00+00',
    '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001'
  ),
  (
    '30000000-0000-4000-8000-000000000005', '20000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000005', 'owner', 'active', 'Beta 老闆',
    '2026-01-01 00:00:00+00', '2026-01-01 00:00:00+00', '2026-01-01 00:00:00+00',
    '10000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000005'
  );

insert into public.customers (
  id, organization_id, customer_no, kind, name, email, source,
  created_at, updated_at, created_by, updated_by
)
values
  (
    '40000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001',
    'C-2026-0001', 'individual', '示範客戶甲', 'customer.alpha@example.test', 'manual',
    '2026-01-02 00:00:00+00', '2026-01-02 00:00:00+00',
    '10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002'
  ),
  (
    '40000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001',
    'C-2026-0002', 'company', '示範客戶乙', 'customer.alpha-2@example.test', 'referral',
    '2026-01-02 00:00:00+00', '2026-01-02 00:00:00+00',
    '10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002'
  ),
  (
    '40000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000002',
    'C-2026-0001', 'individual', 'Beta 示範客戶', 'customer.beta@example.test', 'manual',
    '2026-01-02 00:00:00+00', '2026-01-02 00:00:00+00',
    '10000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000005'
  );

insert into public.locations (
  id, organization_id, customer_id, label, county, district, address_line, is_default,
  created_at, updated_at, created_by, updated_by
)
values
  (
    '50000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000001', '住家', '測試市', '甲區', '示範路 1 號', true,
    '2026-01-02 00:00:00+00', '2026-01-02 00:00:00+00',
    '10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002'
  ),
  (
    '50000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000002', '辦公室', '測試市', '乙區', '樣本街 2 號', true,
    '2026-01-02 00:00:00+00', '2026-01-02 00:00:00+00',
    '10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002'
  ),
  (
    '50000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000002',
    '40000000-0000-4000-8000-000000000003', '測試案場', '測試縣', '丙區', '防水路 3 號', true,
    '2026-01-02 00:00:00+00', '2026-01-02 00:00:00+00',
    '10000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000005'
  );

insert into public.assets (
  id, organization_id, location_id, customer_id, asset_no, asset_type, name, brand, model,
  created_at, updated_at, created_by, updated_by
)
values (
  '60000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001',
  'A-2026-0001', 'air_conditioner', '主臥冷氣', '示範品牌', 'DEMO-01',
  '2026-01-02 00:00:00+00', '2026-01-02 00:00:00+00',
  '10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002'
);

insert into public.checklist_templates (
  id, organization_id, name, description, industry_template, is_active,
  created_at, updated_at, created_by, updated_by
)
values (
  '70000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001',
  '冷氣清洗完工檢查', '測試模板', 'cooling', true,
  '2026-01-03 00:00:00+00', '2026-01-03 00:00:00+00',
  '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001'
);

insert into public.checklist_template_items (
  id, organization_id, checklist_template_id, label, response_type,
  is_required, evidence_required, sort_order, created_at
)
values (
  '70100000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001',
  '70000000-0000-4000-8000-000000000001', '確認運轉正常', 'boolean',
  true, true, 1, '2026-01-03 00:00:00+00'
);

insert into public.service_catalogs (
  id, organization_id, name, industry_template, is_default, is_active,
  created_at, updated_at, created_by, updated_by
)
values (
  '71000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001',
  'Alpha 服務目錄', 'cooling', true, true,
  '2026-01-03 00:00:00+00', '2026-01-03 00:00:00+00',
  '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001'
);

insert into public.service_catalog_items (
  id, organization_id, service_catalog_id, code, category, name, unit,
  default_cost_minor, default_price_minor, tax_rate, checklist_template_id,
  created_at, updated_at, created_by, updated_by
)
values
  (
    '71100000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001',
    '71000000-0000-4000-8000-000000000001', 'AC-CLEAN', '冷氣', '分離式冷氣清洗', '台',
    120000, 250000, 0.0500, '70000000-0000-4000-8000-000000000001',
    '2026-01-03 00:00:00+00', '2026-01-03 00:00:00+00',
    '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001'
  ),
  (
    '71100000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001',
    '71000000-0000-4000-8000-000000000001', 'TRAVEL', '其他', '到府車馬費', '式',
    10000, 50000, 0.0500, null,
    '2026-01-03 00:00:00+00', '2026-01-03 00:00:00+00',
    '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001'
  );

-- contact_phone is E.164 like real intake (the public form normalizes it); a null
-- phone would fail the strict inbox projection schema and blank the whole匣.
insert into public.service_requests (
  id, organization_id, request_no, customer_id, location_id, asset_id, source,
  contact_name, contact_phone, contact_email, subject, description, status,
  original_submission, created_at, updated_at, created_by, updated_by
)
values
  (
    '80000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001',
    'R-2026-0001', '40000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001',
    'manual', '示範客戶甲', '+886912345001', 'customer.alpha@example.test', '冷氣需要清洗', '固定 new 進件測試資料', 'new',
    '{"contactName":"示範客戶甲","contactPhone":"+886912345001","contactEmail":"customer.alpha@example.test","subject":"冷氣需要清洗","description":"固定 new 進件測試資料","source":"manual","submittedAt":"2026-01-04T00:00:00Z","intakeVersion":1,"seeded":true}'::jsonb,
    '2026-01-04 00:00:00+00', '2026-01-04 00:00:00+00',
    '10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002'
  ),
  (
    '80000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001',
    'R-2026-0002', '40000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001',
    'manual', '示範客戶甲', '+886912345002', 'customer.alpha@example.test', '已排程清洗', '工單與技師權限測試資料', 'triaged',
    null,
    '2026-01-05 00:00:00+00', '2026-01-05 00:00:00+00',
    '10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002'
  );

insert into public.service_request_time_windows (
  id, organization_id, service_request_id, starts_at, ends_at, preference_rank, created_at
)
values (
  '80100000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001',
  '80000000-0000-4000-8000-000000000001', '2026-08-10 01:00:00+00',
  '2026-08-10 04:00:00+00', 1, '2026-01-04 00:00:00+00'
);

insert into public.projects (
  id, organization_id, project_no, customer_id, location_id, name, status,
  contracted_amount_minor, currency, actual_started_at,
  created_at, updated_at, created_by, updated_by
)
values (
  '81000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001',
  'P-2026-0001', '40000000-0000-4000-8000-000000000002',
  '50000000-0000-4000-8000-000000000002', '辦公室小型改善工程', 'active',
  5000000, 'TWD', '2026-01-06 00:00:00+00',
  '2026-01-06 00:00:00+00', '2026-01-06 00:00:00+00',
  '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001'
);

insert into public.work_orders (
  id, organization_id, work_order_no, service_request_id, customer_id, location_id,
  asset_id, service_catalog_item_id, title, status, scheduled_start_at, scheduled_end_at,
  created_at, updated_at, created_by, updated_by
)
values (
  '82000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001',
  'W-2026-0001', '80000000-0000-4000-8000-000000000002',
  '40000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001',
  '60000000-0000-4000-8000-000000000001', '71100000-0000-4000-8000-000000000001',
  '主臥冷氣清洗', 'scheduled', '2026-08-10 01:00:00+00', '2026-08-10 03:00:00+00',
  '2026-01-05 00:00:00+00', '2026-01-05 00:00:00+00',
  '10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002'
);

insert into public.assignments (
  id, organization_id, work_order_id, membership_id, duty, status, assigned_by,
  created_at, updated_at, created_by, updated_by
)
values (
  '83000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001',
  '82000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000003',
  'lead', 'assigned', '10000000-0000-4000-8000-000000000002',
  '2026-01-05 00:00:00+00', '2026-01-05 00:00:00+00',
  '10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002'
);

insert into public.work_order_checklists (
  id, organization_id, work_order_id, source_template_id, name, status,
  created_at, updated_at, created_by, updated_by
)
values (
  '84000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001',
  '82000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001',
  '冷氣清洗完工檢查', 'pending', '2026-01-05 00:00:00+00', '2026-01-05 00:00:00+00',
  '10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002'
);

insert into public.work_order_checklist_items (
  id, organization_id, work_order_checklist_id, work_order_id, source_template_item_id,
  label, response_type, is_required, evidence_required, sort_order, created_at, updated_at
)
values (
  '84100000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001',
  '84000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000001',
  '70100000-0000-4000-8000-000000000001', '確認運轉正常', 'boolean',
  true, true, 1, '2026-01-05 00:00:00+00', '2026-01-05 00:00:00+00'
);

-- M5 fixture: an unscheduled draft work order so the dispatcher scheduling and
-- assignment flows have a deterministic starting point (lock_version = 1, no
-- assignments, no checklists). Kept isolated in the 8206 id range so the shared
-- scheduled work order 82000000..0001 above and the 8205 range used by the M5
-- pgTAP suite both stay untouched.
insert into public.work_orders (
  id, organization_id, work_order_no, customer_id, location_id,
  asset_id, title, description, internal_notes, status,
  created_at, updated_at, created_by, updated_by
)
values (
  '82060000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001',
  'W-2026-0002', '40000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001',
  '次臥冷氣清洗（待排程）', '尚未排程的示範工單', '只有店內可見的成本備註', 'draft',
  '2026-01-06 00:00:00+00', '2026-01-06 00:00:00+00',
  '10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002'
);

insert into public.quotes (
  id, organization_id, quote_no, service_request_id, customer_id, location_id,
  status, latest_version_id, currency, created_at, updated_at, created_by, updated_by
)
values (
  '85000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001',
  'Q-2026-0001', '80000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001',
  'draft', '85100000-0000-4000-8000-000000000001', 'TWD',
  '2026-01-04 00:00:00+00', '2026-01-04 00:00:00+00',
  '10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002'
);

insert into public.quote_versions (
  id, organization_id, quote_id, version_no, status, approval_status, title,
  subtotal_minor, discount_minor, tax_minor, total_minor, valid_until,
  created_at, updated_at, created_by, updated_by
)
values (
  '85100000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001',
  '85000000-0000-4000-8000-000000000001', 1, 'draft', 'not_submitted', '冷氣清洗報價',
  350000, 0, 17500, 367500, '2026-12-31',
  '2026-01-04 00:00:00+00', '2026-01-04 00:00:00+00',
  '10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002'
);

insert into public.quote_items (
  id, organization_id, quote_version_id, service_catalog_item_id, name, unit,
  quantity, unit_cost_minor, unit_price_minor, discount_minor, tax_rate,
  subtotal_minor, tax_minor, total_minor, sort_order, created_at, updated_at
)
values
  (
    '85200000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001',
    '85100000-0000-4000-8000-000000000001', '71100000-0000-4000-8000-000000000001',
    '分離式冷氣清洗', '台', 1.000, 120000, 250000, 0, 0.0500,
    250000, 12500, 262500, 1, '2026-01-04 00:00:00+00', '2026-01-04 00:00:00+00'
  ),
  (
    '85200000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001',
    '85100000-0000-4000-8000-000000000001', '71100000-0000-4000-8000-000000000002',
    '到府車馬費', '式', 2.000, 10000, 50000, 0, 0.0500,
    100000, 5000, 105000, 2, '2026-01-04 00:00:00+00', '2026-01-04 00:00:00+00'
  );

-- Immutable sent-version fixture: insert the aggregate/version in final state,
-- then briefly disable only the parent-state guard while loading its snapshot item.
insert into public.quotes (
  id, organization_id, quote_no, service_request_id, customer_id, location_id,
  status, latest_version_id, active_version_id, sent_at, currency,
  created_at, updated_at, created_by, updated_by
)
values (
  '85000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001',
  'Q-2026-0002', '80000000-0000-4000-8000-000000000002',
  '40000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001',
  'sent', '85100000-0000-4000-8000-000000000002',
  '85100000-0000-4000-8000-000000000002', '2026-01-06 00:00:00+00', 'TWD',
  '2026-01-06 00:00:00+00', '2026-01-06 00:00:00+00',
  '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001'
);

insert into public.quote_versions (
  id, organization_id, quote_id, version_no, status, approval_status,
  submitted_for_approval_at, submitted_for_approval_by, approved_at, approved_by,
  title, subtotal_minor, discount_minor, tax_minor, total_minor, valid_until, sent_at,
  created_at, updated_at, created_by, updated_by
)
values (
  '85100000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001',
  '85000000-0000-4000-8000-000000000002', 1, 'sent', 'approved',
  '2026-01-05 08:00:00+00', '10000000-0000-4000-8000-000000000002',
  '2026-01-05 09:00:00+00', '10000000-0000-4000-8000-000000000001',
  '已送出測試報價', 300000, 0, 15000, 315000, '2026-12-31', '2026-01-06 00:00:00+00',
  '2026-01-05 08:00:00+00', '2026-01-06 00:00:00+00',
  '10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001'
);

alter table public.quote_items disable trigger b_guard_quote_item_parent;
alter table public.quote_items disable trigger c_invalidate_quote_approval;

insert into public.quote_items (
  id, organization_id, quote_version_id, service_catalog_item_id, name, unit,
  quantity, unit_cost_minor, unit_price_minor, discount_minor, tax_rate,
  subtotal_minor, tax_minor, total_minor, sort_order, created_at, updated_at
)
values (
  '85200000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000001',
  '85100000-0000-4000-8000-000000000002', '71100000-0000-4000-8000-000000000001',
  '分離式冷氣清洗', '台', 1.000, 120000, 300000, 0, 0.0500,
  300000, 15000, 315000, 1, '2026-01-05 08:00:00+00', '2026-01-05 08:00:00+00'
);

alter table public.quote_items enable trigger b_guard_quote_item_parent;
alter table public.quote_items enable trigger c_invalidate_quote_approval;

insert into public.change_orders (
  id, organization_id, change_order_no, project_id, customer_id, title, reason,
  kind, status, subtotal_minor, tax_minor, total_minor, currency,
  created_at, updated_at, created_by, updated_by
)
values (
  '86000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001',
  'CO-2026-0001', '81000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000002', '增設測試插座', '客戶現場追加需求',
  'addition', 'draft', 100000, 5000, 105000, 'TWD',
  '2026-01-07 00:00:00+00', '2026-01-07 00:00:00+00',
  '10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002'
);

insert into public.change_order_items (
  id, organization_id, change_order_id, name, unit, quantity, unit_price_minor,
  tax_rate, subtotal_minor, tax_minor, total_minor, sort_order, created_at, updated_at
)
values (
  '86100000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001',
  '86000000-0000-4000-8000-000000000001', '增設測試插座', '式', 1.000, 100000,
  0.0500, 100000, 5000, 105000, 1, '2026-01-07 00:00:00+00', '2026-01-07 00:00:00+00'
);

insert into public.payment_milestones (
  id, organization_id, project_id, name, sequence_no, amount_minor, currency,
  due_on, status, created_at, updated_at, created_by, updated_by
)
values (
  '87000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001',
  '81000000-0000-4000-8000-000000000001', '第一期款', 1, 2500000, 'TWD',
  '2026-09-01', 'pending', '2026-01-07 00:00:00+00', '2026-01-07 00:00:00+00',
  '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001'
);

insert into public.maintenance_plans (
  id, organization_id, customer_id, location_id, asset_id, service_catalog_item_id,
  name, cadence_months, lead_days, next_due_on, status,
  created_at, updated_at, created_by, updated_by
)
values (
  '88000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001',
  '60000000-0000-4000-8000-000000000001', '71100000-0000-4000-8000-000000000001',
  '主臥冷氣半年保養', 6, 14, '2026-12-01', 'active',
  '2026-01-08 00:00:00+00', '2026-01-08 00:00:00+00',
  '10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002'
);

insert into public.notifications (
  id, organization_id, channel, membership_id, template_key, template_version,
  payload, status, approval_status, dedupe_key, scheduled_at, attempt_count,
  max_attempts, next_attempt_at, last_error_code, last_error_message, failed_at,
  related_type, related_id, created_at, updated_at
)
values (
  '88100000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001',
  'in_app', '30000000-0000-4000-8000-000000000002', 'work_order_assigned', 1,
  '{"workOrderNo":"W-2026-0001"}', 'failed', 'not_required', 'seed-work-order-assigned',
  '2026-01-05 00:00:00+00', 1, 5, '2026-01-05 00:05:00+00',
  'FIXTURE_TIMEOUT', 'Synthetic timeout', '2026-01-05 00:01:00+00',
  'work_order', '82000000-0000-4000-8000-000000000001',
  '2026-01-05 00:00:00+00', '2026-01-05 00:01:00+00'
);

insert into public.public_access_tokens (
  id, organization_id, resource_type, resource_id, token_hash, scopes,
  expires_at, max_uses, use_count, revoked_at, created_by, created_at
)
values
  (
    '89000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001',
    'quote', '85100000-0000-4000-8000-000000000002',
    extensions.digest('expired-fixture-token-with-test-pepper', 'sha256'),
    array['quote:read', 'quote:respond'], '2026-01-02 00:00:00+00', 5, 0, null,
    '10000000-0000-4000-8000-000000000001', '2026-01-01 00:00:00+00'
  ),
  (
    '89000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001',
    'quote', '85100000-0000-4000-8000-000000000002',
    extensions.digest('revoked-fixture-token-with-test-pepper', 'sha256'),
    array['quote:read', 'quote:respond'], '2027-01-01 00:00:00+00', 5, 0,
    '2026-01-10 00:00:00+00', '10000000-0000-4000-8000-000000000001',
    '2026-01-01 00:00:00+00'
  );

insert into public.events (
  id, organization_id, aggregate_type, aggregate_id, event_type, actor_type,
  actor_user_id, occurred_at, recorded_at, chain_sequence, request_id, payload,
  prev_hash, event_hash
)
values (
  '89100000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001',
  'work_order', '82000000-0000-4000-8000-000000000001', 'work_order.seeded', 'user',
  '10000000-0000-4000-8000-000000000001', '2026-01-05 00:00:00+00',
  '2026-01-05 00:00:01+00', 1,
  '89200000-0000-4000-8000-000000000001', '{"fixture":true}', null,
  extensions.digest(
    '|' || '20000000-0000-4000-8000-000000000001' || '|work_order|'
    || '82000000-0000-4000-8000-000000000001' || '|work_order.seeded|'
    || '10000000-0000-4000-8000-000000000001' || '|'
    || ('2026-01-05 00:00:00+00'::timestamptz)::text || '|'
    || ('2026-01-05 00:00:01+00'::timestamptz)::text || '|1|'
    || '{"fixture": true}'::jsonb::text,
    'sha256'
  )
);

commit;
