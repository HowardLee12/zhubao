# Renoly v2 資料庫規格

> 狀態：可實作規格  
> 目標：Supabase PostgreSQL，clean-slate  
> v1 相容性：無；禁止執行或延伸舊 `supabase/schema.sql`

## 1. 全域規則

### 1.1 Schema 與 extension

- `public`：PostgREST 可見的 domain tables、views 與受控 RPC。
- `private`：憑證、worker-only table/function；不得 expose 到 Supabase API。
- 啟用 `pgcrypto`，主鍵使用 `uuid DEFAULT gen_random_uuid()`。
- 不採 PostgreSQL enum；狀態以 `text + CHECK`，降低後續擴充 migration 風險。
- 時間點用 `timestamptz`，商業日期用 `date`；禁止無時區 `timestamp`。
- 金額用 `bigint *_minor`，幣別用 `text CHECK (currency ~ '^[A-Z]{3}$')`；禁止 float。
- 數量用 `numeric(12,3)`；百分比用 `numeric(7,4)`，例如 `0.0500` 表示 5%。
- 電話儲存正規化 E.164（台灣手機例 `+886912345678`）；顯示格式在前端處理。
- 所有可由使用者輸入的短文字仍用 `text`，搭配 `char_length` CHECK 與 API Zod 上限。

### 1.2 共通欄位

除 append-only 或 join table 外，tenant table 至少包含：

```sql
id uuid primary key default gen_random_uuid(),
organization_id uuid not null,
created_at timestamptz not null default now(),
updated_at timestamptz not null default now(),
created_by uuid null references auth.users(id),
updated_by uuid null references auth.users(id),
lock_version integer not null default 1 check (lock_version > 0)
```

- aggregate root 每次更新都必須同步 `updated_at` 並 `lock_version + 1`。
- 重要記錄不 hard delete，以 status 或 `deleted_at` 封存。
- 所有父表增加 `UNIQUE (organization_id, id)`；子表使用 composite FK：

```sql
foreign key (organization_id, customer_id)
  references public.customers (organization_id, id)
```

如此即使應用程式漏檢查，也無法把 A 店家的子資料連到 B 店家。

### 1.3 命名、刪除與時間

- table／column：`snake_case`；API DTO：`camelCase`。
- FK index 必須顯式建立，Postgres 不會自動為 FK 建 index。
- `updated_at` trigger 只負責 timestamp；`updated_by` 與 `lock_version` 由 RPC／application service 明確寫入。
- `organizations` 只可停用；不得 cascade 刪除整個租戶。
- draft child 可由 owner/admin hard delete；已送出或已執行的交易記錄只能取消／封存。
- PII soft-deletion 後依 retention job 匿名化，詳見安全規格。

## 2. 身分與租戶

### 2.1 `organizations`

| 欄位 | 型別／預設 | 約束與用途 |
|---|---|---|
| id | uuid | PK |
| slug | text | `2..50`，小寫英數與 `-`；unique |
| name | text | `1..120` |
| legal_name | text nullable | `<=200` |
| tax_id | text nullable | `<=20`；不假設只有台灣統編格式 |
| phone | text nullable | E.164 |
| timezone | text default `Asia/Taipei` | IANA timezone，API allowlist 驗證 |
| currency | text default `TWD` | ISO-4217 三碼 |
| industry_template | text default `general_field_service` | `general_field_service/cooling/plumbing/waterproofing/renovation` |
| status | text default `active` | `active/suspended/closed` |
| settings | jsonb default `{}` | 僅放低風險 UI／流程設定；最大 32 KB |
| created_at / updated_at | timestamptz | 共通欄位 |
| lock_version | integer | optimistic concurrency |

Indexes：unique `lower(slug)`；`(status, created_at)`。

### 2.2 `memberships`

| 欄位 | 型別／預設 | 約束與用途 |
|---|---|---|
| id / organization_id | uuid | PK、租戶 FK |
| user_id | uuid | FK `auth.users(id)`，不可空 |
| role | text | `owner/admin/dispatcher/technician/accountant/viewer` |
| status | text default `invited` | `invited/active/suspended/removed` |
| display_name | text | `1..80`，組織內顯示名 |
| phone | text nullable | E.164 |
| invited_by | uuid nullable | FK `auth.users` |
| invited_at / joined_at / suspended_at / removed_at | timestamptz nullable | lifecycle |
| created_at / updated_at / lock_version |  | 共通欄位 |

Constraints／indexes：

- `UNIQUE (organization_id, user_id)`；重新加入時復用原 row。
- 每個組織至少一名 active owner，透過 `change_membership_role()` RPC deferred validation 保護。
- `(user_id, status)`、`(organization_id, role, status)`。

## 3. 客戶、地址與設備

### 3.1 `customers`

| 欄位 | 型別 | 說明 |
|---|---|---|
| id / organization_id | uuid | PK、租戶 |
| customer_no | text | 組織內人類可讀編號，unique |
| kind | text | `individual/company` |
| name | text | `1..120` |
| phone | text nullable | E.164 |
| email | text nullable | lower-case，最大 254 |
| company_name / tax_id | text nullable | 公司資訊 |
| source | text default `manual` | `line/phone/web/referral/manual/import` |
| tags | text[] default `{}` | 最多 20 個、單項 30 字元，由 API 驗證 |
| notes | text default `` | 內部備註，最大 5,000 |
| marketing_consent_at | timestamptz nullable | 行銷同意證據時間 |
| marketing_consent_source | text nullable | 同意來源／版本 |
| last_contact_at | timestamptz nullable | 排序用 |
| deleted_at | timestamptz nullable | soft delete |
| 共通欄位 |  | timestamps、actor、lock |

Indexes：

- unique `(organization_id, customer_no)`。
- `(organization_id, lower(name), id)`、`(organization_id, phone)`、`(organization_id, last_contact_at desc)`，皆可依查詢做 partial `WHERE deleted_at IS NULL`。
- 搜尋量增長後才新增 `pg_trgm` GIN；MVP 不先模糊掃全表。

### 3.2 `customer_line_identities`

| 欄位 | 型別 | 說明 |
|---|---|---|
| id / organization_id | uuid | PK、租戶 |
| customer_id | uuid | composite FK customer |
| line_channel_id | uuid | composite FK line channel |
| line_user_id | text | LINE scoped user id；個資 |
| display_name | text nullable | 最近一次同步值 |
| picture_url | text nullable | 不長期依賴其可用性 |
| friend_status | text | `unknown/friend/blocked/unfollowed` |
| followed_at / unfollowed_at | timestamptz nullable | lifecycle |
| created_at / updated_at | timestamptz |  |

Constraints：unique `(line_channel_id, line_user_id)`；unique `(organization_id, customer_id, line_channel_id)`。不得單憑跨 channel 相同名稱合併客戶。

### 3.3 `locations`

| 欄位 | 型別 | 說明 |
|---|---|---|
| id / organization_id | uuid | PK、租戶 |
| customer_id | uuid | composite FK |
| label | text default `主要地址` | `1..80` |
| contact_name / contact_phone | text nullable | 現場聯絡人 |
| postal_code | text nullable | `<=12` |
| county / district / address_line | text | `address_line` 必填 `1..300` |
| latitude / longitude | numeric(9,6) nullable | range `[-90,90]` / `[-180,180]` |
| access_notes | text default `` | 門禁、停車等，最大 2,000 |
| is_default | boolean default false | 每客戶至多一個 active default |
| deleted_at | timestamptz nullable |  |
| 共通欄位 |  |  |

Indexes：`(organization_id, customer_id, deleted_at)`；partial unique `(organization_id, customer_id) WHERE is_default AND deleted_at IS NULL`。

### 3.4 `assets`

| 欄位 | 型別 | 說明 |
|---|---|---|
| id / organization_id | uuid | PK、租戶 |
| location_id | uuid | composite FK，必填 |
| customer_id | uuid | composite FK；與 location.customer 必須一致，由 trigger/RPC 驗證 |
| asset_no | text | 組織內 unique |
| asset_type | text | 例如 `air_conditioner/water_heater/pump/appliance/other` |
| name | text | 客戶可辨識名稱，例如「主臥冷氣」 |
| brand / model / serial_number | text nullable | 各 `<=120` |
| installed_on / warranty_expires_on | date nullable |  |
| last_serviced_at | timestamptz nullable | 完工交易更新 |
| status | text default `active` | `active/inactive/retired` |
| attributes | jsonb default `{}` | 模板欄位，例如噸數；最大 32 KB |
| deleted_at | timestamptz nullable |  |
| 共通欄位 |  |  |

Indexes：unique `(organization_id, asset_no)`；`(organization_id, location_id, status)`；`(organization_id, customer_id, status)`；optional partial `(organization_id, serial_number) WHERE serial_number IS NOT NULL`（非 unique）。

## 4. 需求與專案

### 4.1 `service_requests`

| 欄位 | 型別 | 說明 |
|---|---|---|
| id / organization_id | uuid | aggregate root |
| request_no | text | 組織內 unique |
| customer_id / location_id / asset_id | uuid nullable | triage 後關聯；composite FK |
| source | text | `line/phone/web/referral/manual` |
| source_reference | text nullable | webhook event 等外部追蹤 id |
| contact_name | text | 需求當下快照，`1..120` |
| contact_phone / contact_email | text nullable | 至少一個聯絡方式，LINE source 可由 identity 取代 |
| customer_line_identity_id | uuid nullable | LINE 來源關聯 |
| subject | text | canonical，`1..160`；API DTO 對外用 `subject`，openapi `title` 為別名 |
| category | text nullable | 產業服務類別；供 API DTO；triage 可覆寫 |
| description | text default `` | 最大 10,000 |
| priority | text default `normal` | `low/normal/high/urgent` |
| status | text default `new` | `new/triaged/quoting/quoted/converted/declined/cancelled` |
| assigned_member_id | uuid nullable | 內部負責人 membership |
| triaged_at / quoted_at / converted_at / closed_at | timestamptz nullable | 狀態時間 |
| decline_reason / cancellation_reason | text nullable | 關閉必填 |
| converted_project_id / converted_work_order_id | uuid nullable | convert 結果；至少一個 |
| internal_note | text default `` | staff-only triage 備註，最大 2,000；不可回 public DTO |
| original_submission | jsonb nullable | intake 寫入的不可變原始內容快照；guard trigger 阻止覆寫；triage/PATCH 不得改動 |
| summary_edited_by / summary_edited_at | uuid / timestamptz nullable | 摘要最後編輯者與時間；PATCH 內容時更新，original 不動 |
| metadata | jsonb default `{}` | intake 額外欄位，最大 32 KB |
| 共通欄位 |  | timestamps、actor、lock |

Indexes：unique `(organization_id, request_no)`；`(organization_id, status, created_at desc, id desc)`；`(organization_id, assigned_member_id, status)`；partial `(organization_id, source, source_reference) WHERE source_reference IS NOT NULL`。

### 4.2 `service_request_time_windows`

`id, organization_id, service_request_id, starts_at, ends_at, preference_rank smallint, created_at`。

Constraints：`ends_at > starts_at`、rank `1..5`、unique `(service_request_id, preference_rank)`；composite FK。Index `(organization_id, service_request_id)`。

### 4.3 `projects`

| 欄位 | 型別 | 說明 |
|---|---|---|
| id / organization_id | uuid | aggregate root |
| project_no | text | 組織內 unique |
| customer_id / location_id | uuid | composite FK，必填 |
| service_request_id | uuid nullable | 來源需求 |
| name | text | `1..160` |
| description | text default `` | 最大 10,000 |
| status | text default `draft` | `draft/active/on_hold/completed/cancelled` |
| owner_member_id | uuid nullable | 專案負責人 |
| planned_start_on / planned_end_on | date nullable | end >= start |
| actual_started_at / completed_at | timestamptz nullable |  |
| contracted_amount_minor | bigint default 0 | >= 0；已接受報價／追加同步 |
| currency | text default `TWD` |  |
| cancellation_reason | text nullable | cancel 必填 |
| 共通欄位 |  |  |

Indexes：unique `(organization_id, project_no)`；`(organization_id, status, updated_at desc, id desc)`；`(organization_id, customer_id, created_at desc)`；`(organization_id, owner_member_id, status)`。

## 5. 工單、指派、檢查與媒體

### 5.1 `work_orders`

| 欄位 | 型別 | 說明 |
|---|---|---|
| id / organization_id | uuid | aggregate root |
| work_order_no | text | 組織內 unique |
| project_id / service_request_id | uuid nullable | 可直接源自 request，project 非必需 |
| customer_id / location_id | uuid | 必填 composite FK |
| asset_id | uuid nullable | 設備型服務才用 |
| service_catalog_item_id | uuid nullable | 主要服務類型 |
| title | text | `1..160` |
| description | text default `` | 對現場說明，最大 5,000 |
| customer_notes | text default `` | 可進客戶版 DTO，最大 2,000 |
| technician_notes | text default `` | 指派技師可見，最大 5,000 |
| internal_notes | text default `` | 僅管理端內部使用，最大 10,000；transition DTO 不回傳 |
| completion_summary | text nullable | complete 時建議必填 |
| priority | text default `normal` | `low/normal/high/urgent` |
| status | text default `draft` | `draft/scheduled/dispatched/en_route/on_site/paused/completed/cancelled` |
| scheduled_start_at / scheduled_end_at | timestamptz nullable | scheduled 後必填；end > start |
| dispatched_at / en_route_at / on_site_at / paused_at / completed_at / cancelled_at | timestamptz nullable | transition timestamp |
| cancellation_reason | text nullable | cancel 必填 |
| accepted_quote_version_id | uuid nullable | 施工依據 |
| requires_customer_signoff | boolean default false |  |
| customer_signed_at | timestamptz nullable | token 流程寫入 |
| 共通欄位 |  |  |

至少 `project_id` 或 `service_request_id` 其中之一可為 null，允許手動建立；但 customer/location 必須存在。所有相互關聯的 customer/location/asset/project 必須同租戶且一致，由 transaction RPC 驗證。

Indexes：

- unique `(organization_id, work_order_no)`。
- `(organization_id, status, scheduled_start_at, id)`。
- `(organization_id, project_id, scheduled_start_at)`、`(organization_id, customer_id, created_at desc)`、`(organization_id, asset_id, completed_at desc)`。
- partial `(organization_id, scheduled_start_at) WHERE status IN ('scheduled','dispatched','en_route','on_site')`。

### 5.2 `assignments`

| 欄位 | 型別 | 說明 |
|---|---|---|
| id / organization_id | uuid |  |
| work_order_id | uuid | composite FK |
| membership_id | uuid | 必須是 active membership |
| duty | text default `technician` | `lead/technician/helper/observer` |
| status | text default `assigned` | `assigned/accepted/declined/checked_in/completed/cancelled` |
| assigned_at | timestamptz default now() |  |
| accepted_at / declined_at / checked_in_at / checked_out_at / completed_at / cancelled_at | timestamptz nullable |  |
| decline_reason | text nullable | decline 必填 |
| assigned_by | uuid | auth user |
| created_at / updated_at / lock_version |  |  |

Constraint：unique `(organization_id, work_order_id, membership_id)`；同工單最多一個非取消 lead（partial unique）。Indexes `(organization_id, membership_id, status, work_order_id)`、`(organization_id, work_order_id, status)`。

### 5.3 Checklist tables

#### `checklist_templates`

`id, organization_id, name, description, industry_template, is_active, created_by, created_at, updated_at, lock_version`。name `1..120`；index `(organization_id, is_active, name)`。

#### `checklist_template_items`

`id, organization_id, checklist_template_id, label, description, response_type, is_required, evidence_required, options jsonb, sort_order, created_at`。

- `response_type`: `boolean/text/number/single_choice/multi_choice/photo`。
- `options` 僅 choice 類型可非空，陣列最多 30 項。
- unique `(checklist_template_id, sort_order)`。

#### `work_order_checklists`

`id, organization_id, work_order_id, source_template_id nullable, name, status, completed_at, completed_by_membership_id, created_at, updated_at, lock_version`。

- `status`: `pending/in_progress/completed/reopened`。
- 建立時複製 template name/items，之後模板修改不影響工單快照。
- index `(organization_id, work_order_id, status)`。

#### `work_order_checklist_items`

`id, organization_id, work_order_checklist_id, source_template_item_id nullable, label, response_type, is_required, evidence_required, options jsonb, response jsonb, completed_at, completed_by_membership_id, sort_order, created_at, updated_at`。

由 API 依 `response_type` 驗證 `response` schema；DB 限制 JSON 最大 16 KB。unique `(work_order_checklist_id, sort_order)`。

### 5.4 `photos`

| 欄位 | 型別 | 說明 |
|---|---|---|
| id / organization_id | uuid |  |
| service_request_id | uuid nullable | intake 照片 |
| work_order_id | uuid nullable | 現場照片 |
| checklist_item_id | uuid nullable | 證據關聯 |
| category | text | `intake/before/after/issue/receipt/signature/other` |
| status | text default `pending` | `pending/processing/ready/quarantined/failed/deleted` |
| storage_path / thumbnail_path | text | server 產生；thumbnail ready 前可 null |
| original_filename | text nullable | 清理後顯示，最大 200 |
| mime_type | text nullable | server sniff 結果 |
| byte_size / width / height | bigint/integer nullable | 非負，像素上限見 security |
| sha256 | text nullable | hex 64；去重／完整性 |
| caption | text default `` | 最大 1,000 |
| captured_at | timestamptz nullable | EXIF 只能作提示，不可信授權依據 |
| uploaded_by_membership_id | uuid nullable | 員工上傳 |
| customer_line_identity_id | uuid nullable | 客戶 LINE 上傳 |
| deleted_at / ready_at | timestamptz nullable |  |
| created_at / updated_at / lock_version |  |  |

Constraint：`num_nonnulls(service_request_id, work_order_id) = 1`；checklist item 必須屬於同一 work order。unique `(organization_id, storage_path)`。Indexes `(organization_id, work_order_id, category, created_at)`、`(organization_id, service_request_id, created_at)`、partial `(status, created_at) WHERE status IN ('pending','processing')`。

### 5.5 `events`

Append-only：

`id uuid, organization_id, aggregate_type, aggregate_id, event_type, actor_type, actor_user_id nullable, actor_customer_id nullable, occurred_at, recorded_at, chain_sequence, request_id, idempotency_key nullable, payload jsonb, prev_hash nullable, event_hash`。

- `aggregate_type`: allowlist `service_request/project/work_order/quote/change_order/payment_milestone/maintenance_plan/line_channel`。
- `actor_type`: `user/customer/system/line`；依類型檢查 actor 欄位。
- payload 僅存稽核所需差異，不複製秘密或完整 PII，最大 32 KB。
- 任何 authenticated role 都不得 UPDATE/DELETE；只由受控 function INSERT。
- `occurred_at` 是經規則驗證的業務發生時間；`recorded_at` 是資料庫實際寫入時間。離線補登不以業務時間決定 hash-chain head。
- `chain_sequence` 在 `(organization_id, aggregate_type, aggregate_id)` 內單調遞增且唯一；append function 以 aggregate advisory transaction lock 序列化，hash 同時涵蓋 sequence 與 recorded time。
- indexes `(organization_id, aggregate_type, aggregate_id, occurred_at, id)`、`(organization_id, event_type, occurred_at desc)`。

## 6. 服務目錄與報價

### 6.1 `service_catalogs`

`id, organization_id, name, description, industry_template, is_default, is_active, created_by, updated_by, created_at, updated_at, lock_version`。

Partial unique 每組織一個 default active catalog；index `(organization_id, is_active, name)`。

### 6.2 `service_catalog_items`

| 欄位 | 型別 | 說明 |
|---|---|---|
| id / organization_id / service_catalog_id | uuid |  |
| code | text nullable | 組織／catalog 內 unique |
| category / name | text | 各 `1..120` |
| description / specification | text | 最大 5,000 |
| unit | text default `式` | 最大 20 |
| default_cost_minor | bigint default 0 | >= 0，僅授權角色可見 |
| default_price_minor | bigint default 0 | >= 0 |
| tax_rate | numeric(7,4) default 0 | `0..1` |
| checklist_template_id | uuid nullable | 建工單時可套用 |
| is_active | boolean default true |  |
| metadata | jsonb default `{}` | 最大 16 KB |
| sort_order | integer default 0 |  |
| 共通欄位 |  |  |

Indexes：`(organization_id, service_catalog_id, is_active, sort_order)`；partial unique `(organization_id, service_catalog_id, code) WHERE code IS NOT NULL`。

### 6.3 `quotes`

| 欄位 | 型別 | 說明 |
|---|---|---|
| id / organization_id | uuid | aggregate root |
| quote_no | text | 組織內 unique |
| service_request_id / project_id | uuid nullable | 至少可一個來源，手動報價可皆 null |
| customer_id / location_id | uuid | 必填 |
| status | text default `draft` | `draft/sent/viewed/accepted/rejected/expired/cancelled` |
| latest_version_id | uuid nullable | 最新 draft/sent version |
| active_version_id | uuid nullable | 當前對客版本 |
| accepted_version_id | uuid nullable | 接受版本 |
| sent_at / first_viewed_at / accepted_at / rejected_at / expires_at / cancelled_at | timestamptz nullable |  |
| rejection_reason / cancellation_reason | text nullable |  |
| currency | text default `TWD` | 所有版本一致 |
| 共通欄位 |  |  |

新增 version 後才回填 cyclic FK；migration 先建 tables，最後 `ALTER TABLE` 加 composite FK。Indexes：unique `(organization_id, quote_no)`；`(organization_id, status, updated_at desc, id desc)`；`(organization_id, customer_id, created_at desc)`。

M4 Pilot 另以 unique index 保證一筆 `service_request` 最多一個 quote aggregate；修訂建立新的 `quote_versions.version_no`，而非另一個 quote。建立草稿會在同一 transaction 將 request `triaged → quoting`；送出會改為 `quoted`；拒絕會回 `quoting`；已進入 sent/viewed/rejected lifecycle 的 request 必須有 accepted quote 才能轉工單／專案。

### 6.4 `quote_versions`

| 欄位 | 型別 | 說明 |
|---|---|---|
| id / organization_id / quote_id | uuid |  |
| version_no | integer | >= 1，quote 內 unique |
| status | text default `draft` | `draft/sent/superseded/accepted/rejected/expired/cancelled` |
| approval_status | text default `not_submitted` | `not_submitted/pending/approved/changes_requested`；與對客 lifecycle 分離 |
| title | text | `1..160` |
| customer_notes / internal_notes / terms | text | 各最大 10,000；internal 永不進 public DTO |
| subtotal_minor / discount_minor / tax_minor / total_minor | bigint | 全部 >= 0；total = subtotal - discount + tax |
| valid_until | date nullable |  |
| sent_at / accepted_at / rejected_at | timestamptz nullable |  |
| submitted_for_approval_at / approved_at | timestamptz nullable | 內部核准時間 |
| submitted_for_approval_by / approved_by | uuid nullable | membership composite FK |
| approval_rejection_reason | text nullable | 退回必填，最大 2,000 |
| created_from_version_id | uuid nullable | clone 來源 |
| created_by / created_at / updated_at / lock_version |  |  |

- 只有 `draft` 可更新或增刪 items。
- 任何影響金額、條款或客戶可見內容的修改都將 `approval_status` 重設為 `not_submitted`。
- 只有 `approval_status = approved` 的版本可送出；Phase 1 由 owner/admin approve，並可在單一 transaction approve-and-send。
- 送出時使用交易重新計算 totals，不信任 client totals。
- unique `(organization_id, quote_id, version_no)`；index `(organization_id, quote_id, version_no desc)`。

### 6.5 `quote_items`

`id, organization_id, quote_version_id, service_catalog_item_id nullable, group_name, name, specification, unit, quantity numeric(12,3), unit_cost_minor bigint, unit_price_minor bigint, discount_minor bigint, tax_rate numeric(7,4), subtotal_minor bigint, tax_minor bigint, total_minor bigint, sort_order integer, created_at, updated_at`。

Constraints：quantity `> 0`；money `>=0`；rate `0..1`；unique `(quote_version_id, sort_order)`。所有金額由 server/RPC 以整數／numeric 算術計算：每列 `quantity × unit_price_minor` 先 half-up 到最小幣別、折扣後的每列稅額再 half-up，quote totals 是已取整各列的加總；禁止以 JavaScript `number` 或 PostgreSQL float 計錢。Indexes `(organization_id, quote_version_id, sort_order)`、`(organization_id, service_catalog_item_id)`。

## 7. 追加與收款

### 7.1 `change_orders`

| 欄位 | 型別 | 說明 |
|---|---|---|
| id / organization_id | uuid | aggregate root |
| change_order_no | text | 組織內 unique |
| project_id | uuid | 必填 |
| work_order_id | uuid nullable | 現場發起來源 |
| customer_id | uuid | 與 project 一致 |
| title / reason | text | 必填，最大 160 / 5,000 |
| kind | text default `addition` | `addition/deduction` |
| status | text default `draft` | `draft/sent/accepted/rejected/cancelled` |
| subtotal_minor / tax_minor / total_minor | bigint | total 可為正值；方向由 kind 表達 |
| currency | text | 與 project 一致 |
| sent_at / accepted_at / rejected_at / cancelled_at | timestamptz nullable |  |
| rejection_reason / cancellation_reason | text nullable |  |
| customer_signed_name | text nullable | 簽認顯示名，不宣稱法定數位簽章 |
| customer_signed_at | timestamptz nullable |  |
| 共通欄位 |  |  |

只有 draft 可編輯 items。accepted 後 transaction 更新 project contracted amount 並建立 event。Indexes：unique `(organization_id, change_order_no)`；`(organization_id, project_id, status, created_at desc)`。

### 7.2 `change_order_items`

`id, organization_id, change_order_id, service_catalog_item_id nullable, name, specification, unit, quantity, unit_price_minor, tax_rate, subtotal_minor, tax_minor, total_minor, sort_order, created_at, updated_at`。約束與 quote item 相同；不儲存內部成本（如需要成本分析由未來模組新增）。

### 7.3 `payment_milestones`

| 欄位 | 型別 | 說明 |
|---|---|---|
| id / organization_id | uuid | aggregate root |
| project_id | uuid | 必填 |
| quote_version_id / change_order_id | uuid nullable | 請款依據 |
| name | text | `1..120` |
| sequence_no | integer | project 內排序 |
| amount_minor | bigint | > 0 |
| currency | text | 與 project 一致 |
| due_on | date nullable |  |
| status | text default `pending` | `pending/invoiced/overdue/paid/waived/cancelled` |
| invoiced_at / paid_at / waived_at / cancelled_at | timestamptz nullable |  |
| payment_method | text nullable | `cash/transfer/card/other`；僅紀錄，不存卡資料 |
| external_reference | text nullable | 對帳末碼／外部交易 id，最大 120 |
| notes | text default `` | 最大 2,000 |
| 共通欄位 |  |  |

Constraints：unique `(organization_id, project_id, sequence_no)`；paid 必須有 `paid_at`。Indexes `(organization_id, status, due_on, id)`、`(organization_id, project_id, sequence_no)`。

## 8. 保養、通知與 LINE

### 8.1 `maintenance_plans`

| 欄位 | 型別 | 說明 |
|---|---|---|
| id / organization_id | uuid | aggregate root |
| customer_id / location_id | uuid | 必填 |
| asset_id | uuid nullable | 設備保養可用 |
| service_catalog_item_id | uuid nullable | 回訪服務 |
| name | text | `1..160` |
| cadence_months | smallint | `1..60` |
| lead_days | smallint default 14 | `0..90` |
| next_due_on | date | 必填 |
| last_completed_work_order_id | uuid nullable |  |
| status | text default `active` | `active/paused/completed/cancelled` |
| auto_prepare_message | boolean default true | 只建草稿，不自動承諾／發送 |
| paused_at / completed_at / cancelled_at | timestamptz nullable |  |
| 共通欄位 |  |  |

Indexes：`(organization_id, status, next_due_on, id)`；`(organization_id, asset_id, status)`。同 asset + service item 可有多個歷史 plan，但 partial unique 只允許一個 active。

### 8.2 `notifications`

此表同時是 transactional outbox。

| 欄位 | 型別 | 說明 |
|---|---|---|
| id / organization_id | uuid |  |
| channel | text | `line/in_app/email/sms`；MVP 實作 line/in_app |
| line_channel_id | uuid nullable | LINE 必填 |
| customer_line_identity_id / membership_id | uuid nullable | recipient，恰一個 |
| template_key / template_version | text/integer | 可追溯模板 |
| payload | jsonb | render 參數，最大 32 KB，不含 secret |
| status | text default `pending` | `pending/processing/sent/delivered/failed/cancelled` |
| approval_status | text default `not_required` | `not_required/pending/approved/rejected`；回訪草稿需 approved 才可 claim |
| dedupe_key | text | 同組織／channel unique |
| scheduled_at | timestamptz default now() |  |
| locked_at / locked_by | timestamptz/text nullable | worker claim |
| attempt_count / max_attempts | smallint | default 0 / 5 |
| next_attempt_at | timestamptz nullable |  |
| provider_message_id | text nullable |  |
| last_error_code / last_error_message | text nullable | message 必須 redacted |
| sent_at / delivered_at / failed_at / cancelled_at | timestamptz nullable |  |
| related_type / related_id | text/uuid nullable | quote/work_order/... |
| created_at / updated_at |  |  |

Indexes：unique `(organization_id, channel, dedupe_key)`；claim partial `(status, approval_status, coalesce(next_attempt_at, scheduled_at), created_at) WHERE status IN ('pending','failed')`；`(organization_id, related_type, related_id, created_at desc)`。claim query 必須限制 `approval_status IN ('not_required','approved')`。

### 8.3 `notification_attempts`

Append-only：`id, notification_id, organization_id, attempt_no, started_at, finished_at, outcome, provider_status, provider_request_id, error_code, latency_ms`。unique `(notification_id, attempt_no)`；不存完整 provider body/token/recipient。

### 8.4 `line_channels`

只放非敏感欄位：

`id, organization_id, name, channel_id, basic_id nullable, liff_id nullable, status, webhook_verified_at nullable, last_webhook_at nullable, last_error_code nullable, credential_version integer, created_by, updated_by, created_at, updated_at, lock_version`。

- status：`pending/active/disabled/error`。
- unique `channel_id`（LINE channel 不可同時綁兩店）；第一版 partial unique 每組織一個 active。
- API response 永不含 secret/token 或 ciphertext。

### 8.5 `private.line_channel_credentials`

`line_channel_id uuid primary key, organization_id uuid, secret_ciphertext bytea, secret_nonce bytea, access_token_ciphertext bytea, access_token_nonce bytea, key_version integer, token_expires_at nullable, rotated_at, created_at, updated_at`。

- 僅 backend worker 專用 DB role 可 SELECT；`anon`、`authenticated`、PostgREST 全部 REVOKE。
- ciphertext 使用應用層 envelope encryption；DB 不持有 master key。

### 8.6 `line_webhook_events`

`id, organization_id, line_channel_id, webhook_event_id, event_type, event_timestamp, payload jsonb, payload_sha256, status, attempt_count, next_attempt_at, locked_at, processed_at, error_code, received_at`。

- status：`pending/processing/processed/ignored/failed`。
- unique `(line_channel_id, webhook_event_id)`；若 provider 無 id，使用 `(line_channel_id, payload_sha256, event_timestamp)` fallback。
- claim partial index同 outbox；payload 90 天 retention。

### 8.7 M7 — 自由訊息聚合與 AI 整理草稿

M7 把 LINE 裡的自由文字／圖片訊息聚合成「待確認進件草稿」（intake draft），由 AI 只出草稿、人工 confirm 每一步。**核心不變量：AI extractor 故障（down／timeout／壞輸出）時，訊息仍以 `origin='manual'` 草稿落地，永不遺失**（降級 gate 落在 DB 層，見 ADR 0007）。

migration：`supabase/migrations/202607200008_v2_m7_intake_aggregation.sql`；pgTAP：`supabase/tests/13_m7_intake_aggregation.test.sql`。五張新表全部 `FORCE ROW LEVEL SECURITY`、`REVOKE ALL FROM public, anon, authenticated, service_role`，只授 `authenticated` SELECT（owner/admin/dispatcher RLS-scoped inbox 讀取），所有 mutation 一律經 security-definer RPC。

#### `conversations`（aggregate root）

| 欄位 | 型別 | 說明 |
|---|---|---|
| id / organization_id | uuid | aggregate root，`(organization_id, id)` unique |
| line_channel_id | uuid | composite FK 帶 organization_id |
| customer_line_identity_id | uuid nullable | 配對後帶入；composite FK |
| line_user_id | text | 配對前的聚合 key，`1..255` |
| status | text default `open` | `open/drafted/converted/dismissed` |
| last_message_at | timestamptz nullable |  |
| message_count | integer default 0 | `>= 0` |
| created_at / updated_at / lock_version |  | mutable aggregate |

- **partial unique** `(organization_id, line_channel_id, line_user_id) WHERE status='open'`：同一 sender 同時只有一個 open conversation，連續訊息 coalesce。
- confirm/dismiss 後離開 `open`，之後的新訊息開新 conversation。

#### `inbound_messages`（append-only child）

| 欄位 | 型別 | 說明 |
|---|---|---|
| id / organization_id | uuid | `(organization_id, id)` unique |
| conversation_id | uuid | composite FK |
| line_channel_id | uuid | composite FK |
| line_webhook_event_id | uuid nullable | provenance FK → `line_webhook_events` |
| line_message_id | text nullable | `1..120` |
| message_type | text | `text/image/sticker/other` |
| text_content | text nullable | `<= 20000`，**write-once** |
| raw | jsonb | 原始 message object，`<= 256 KB`，**write-once** |
| sent_at / received_at / created_at | timestamptz |  |

- **dedup unique** `(organization_id, line_channel_id, line_message_id) WHERE line_message_id is not null`。
- **write-once guard trigger** `b_guard_inbound_message_immutable`（鏡射 `private.guard_original_submission`）：`raw`／`text_content` 於 UPDATE 被拒，`errcode P0001 / INBOUND_MESSAGE_IMMUTABLE`。

#### `message_attachments`（media child，private bucket）

`id, organization_id, inbound_message_id`（composite FK）、`kind`（`image`）、`status`（`pending/processing/ready/quarantined/failed/deleted`）、`storage_bucket`（固定 `v2-intake-photos`）、`storage_path nullable, thumbnail_path nullable, content_hash`（`^[0-9a-f]{64}$`）、`mime_type`（`image/jpeg|png|webp`）、`byte_size`（`1..10 MB`）、`created_at`。`ready` 需 storage_path/content_hash/mime_type/byte_size 齊備。storage_path unique。只用短效 signed URL，不公開。

#### `intake_extraction_runs`（append-only 稽核 + extraction inbox）

`id, organization_id, conversation_id`（composite FK）、`intake_draft_id nullable`、`extractor_name`（`fake/fireworks`）、`model_version nullable`、`status`（`succeeded/failed/degraded`）、`confidence numeric(4,3) [0,1] nullable`、`input_message_ids uuid[]`、`output jsonb nullable (<= 64 KB)`、`error_code nullable`、`latency_ms nullable`、`started_at/finished_at/created_at`。append-only trigger `immutable_intake_extraction_runs`（`errcode P0001 / APPEND_ONLY_RECORD`）。**failed run 不記 confidence／output**。

#### `intake_drafts`（待確認進件草稿）

| 欄位 | 型別 | 說明 |
|---|---|---|
| id / organization_id | uuid | `(organization_id, id)` unique |
| conversation_id | uuid | composite FK |
| status | text default `pending_review` | `pending_review/confirmed/dismissed/superseded` |
| origin | text | `ai`（AI 出草稿）／`manual`（降級草稿）— 滿足「顯示來源」gate |
| confidence | numeric(4,3) nullable | 整體，`[0,1]` |
| fields | jsonb default `{}` | **每欄 provenance** `{ value, source: 'line'\|'ai'\|'manual', confidence }`，`<= 64 KB` |
| summary / title | text nullable | `<= 4000` / `<= 160` |
| missing_fields | text[] default `{}` |  |
| extraction_run_id | uuid nullable | composite FK → runs |
| converted_service_request_id | uuid nullable | confirm 後連結；composite FK |
| created_at / updated_at / lock_version |  | mutable aggregate |

- **partial unique** `(organization_id, conversation_id) WHERE status='pending_review'`：一 conversation 一 active draft。
- `status='confirmed'` 必須有 `converted_service_request_id`。

#### events allowlist 擴充

`events_aggregate_type_chk` 加入 `'conversation'`、`'intake_draft'`（同 M3 加 `'customer'`）。`actor_type` 已含 `line/system`。confirm/dismiss 各 append 一筆 `intake_draft.confirmed` / `intake_draft.dismissed` hash-chained 事件。

#### transaction RPC（見 §12 一覽）

- **worker（service_role only）**：`ingest_inbound_message`、`attach_message_media`、`record_extraction_run`、`create_intake_draft`、`claim_intake_extraction_runs`（SKIP LOCKED）、`mark_extraction_succeeded`、`mark_extraction_failed`。
- **staff（authenticated，內部 has_org_role gate）**：`confirm_intake_draft`、`dismiss_intake_draft`。
- **降級 gate**：`record_extraction_run(status='failed')` 在同一 transaction 寫 failed run **並** upsert `origin='manual'` 草稿；`mark_extraction_failed` 為其薄封裝。
- **confirm-once**：`confirm_intake_draft` 建 `service_request(source='line', source_reference=conversation_id, customer_line_identity_id, original_submission=草稿快照)`，並靠既有 `service_requests (organization_id, source, source_reference)` partial unique 保證重放回傳同一 service_request；之後由 UI 走 M3 `triage/convert`（service_requests 無需改 schema）。

## 9. 支援資料表

### 9.1 `public_access_tokens`

`id, organization_id, resource_type, resource_id, token_hash bytea, scopes text[], expires_at, max_uses nullable, use_count default 0, last_used_at nullable, revoked_at nullable, created_by, created_at`。

- resource type：`intake_form/quote/change_order/work_order_signoff`。
- token 只在建立 response 出現一次；DB 僅存 `SHA-256(token + server pepper)`。
- quote 綁定已核准的 immutable version；change order 只能在 `sent` 建立；work-order signoff 只能綁定要求簽收、尚未簽收的 `on_site/paused` 工單。每次 consume 仍重查可回覆 lifecycle，不只在 mint 時檢查。
- unique `token_hash`；index `(organization_id, resource_type, resource_id, revoked_at)`。

### 9.2 `idempotency_keys`

`id, organization_id nullable, actor_fingerprint, method, path_template, idempotency_key, request_hash, state, response_status nullable, response_body jsonb nullable, resource_type nullable, resource_id nullable, locked_until nullable, expires_at, created_at, updated_at`。

- state：`processing/completed/failed`。
- unique `(actor_fingerprint, method, path_template, idempotency_key)`。
- 同 key 不同 request hash 回 409；processing 未過期回 409 `IDEMPOTENCY_IN_PROGRESS`。
- 一般保留 24 小時；接受報價、標記付款等不可逆操作保留 30 天。

### 9.3 `document_sequences`

`organization_id, document_type, period_key, current_value, updated_at`，PK `(organization_id, document_type, period_key)`。transaction 內 UPSERT + `RETURNING current_value`。document type allowlist `customer/request/project/work_order/quote/change_order`。

## 10. 狀態機

狀態不得由通用 PATCH 任意指定；必須使用 transition RPC，鎖 row、驗證前置條件、寫 timestamp/event/outbox。

### 10.1 Service request

| From | 可到 | 必要條件／效果 |
|---|---|---|
| new | triaged, declined, cancelled | triaged 需 customer 與 subject；關閉需 reason |
| triaged | quoting, converted, declined, cancelled | converted 必須建立 work order 或 project |
| quoting | quoted, converted, declined, cancelled | quoted 需至少一個 sent quote version |
| quoted | quoting, converted, declined, cancelled | quoting 表示修訂；converted 關聯接受的報價（若有） |
| converted | — | terminal |
| declined / cancelled | — | terminal；重新開啟需複製新 request |

### 10.2 Project

| From | 可到 | 條件 |
|---|---|---|
| draft | active, cancelled | active 需 customer/location |
| active | on_hold, completed, cancelled | complete 需所有非取消工單完成或明確 override reason |
| on_hold | active, cancelled |  |
| completed / cancelled | — | terminal；修正另建 event，不覆寫歷史 |

### 10.3 Work order

| From | 可到 | 條件／副作用 |
|---|---|---|
| draft | scheduled, cancelled | scheduled 需有效時段與至少一 assignment |
| scheduled | draft, dispatched, cancelled | draft 表示取消排程；清除 schedule 前需理由 |
| dispatched | scheduled, en_route, cancelled | en_route 需 active assignment |
| en_route | on_site, cancelled | 記 `on_site_at` |
| on_site | paused, completed, cancelled | completed 需 required checklist、必要 evidence、前後照與 summary |
| paused | on_site, completed, cancelled |  |
| completed | on_site | 僅 owner/admin、24 小時內、必填 reopen reason |
| cancelled | — | terminal |

### 10.4 Assignment

`assigned → accepted|declined|cancelled`；`accepted → checked_in|cancelled`；`checked_in → completed|cancelled`。declined/completed/cancelled terminal。技師只能轉換自己的 assignment。

### 10.5 Quote and version

- Aggregate：`draft → sent → viewed → accepted|rejected|expired|cancelled`。
- `sent` 可直接 `accepted/rejected/expired/cancelled`（客戶未觸發 view tracking）。
- `viewed` 可再次送出提醒但狀態不倒退。
- 新 draft version 不使 aggregate 從 sent/viewed 倒退；送出新版本時舊 active version `superseded`，aggregate 回 `sent`。
- Version：`draft → sent → accepted|rejected|expired|superseded|cancelled`；只有 draft 可修改。
- accept 必須鎖 aggregate，且只能接受當時的 `active_version_id`；過期或 superseded 回 409。

### 10.6 Change order

`draft → sent → accepted|rejected|cancelled`；sent 可由 owner/admin/dispatcher 撤回為 cancelled，不可回 draft。accepted transaction 更新 project 金額。修訂需取消舊單並建立新單。

### 10.7 Payment milestone

`pending → invoiced|paid|waived|cancelled`；`invoiced → overdue|paid|waived|cancelled`；`overdue → paid|waived|cancelled`。paid/waived/cancelled terminal；付款更正由 owner/admin 專用 `reverse-payment` 轉回 invoiced 並必填 reason/event。

### 10.8 Notification, maintenance, channel

- Notification：`pending → processing|cancelled`；`processing → sent|failed`；`failed → pending|cancelled`；`sent → delivered`。
- Maintenance：`active ↔ paused`；`active|paused → completed|cancelled`。
- LINE channel：`pending → active|error|disabled`；`active → error|disabled`；`error → pending|active|disabled`；`disabled → pending`。

## 11. RLS 設計

所有 `public` tenant tables：

```sql
alter table public.<table> enable row level security;
alter table public.<table> force row level security;
```

### 11.1 Helper functions

建立以下 `SECURITY DEFINER` function，owner 為專用 non-login role，固定 `search_path = pg_catalog, public`，REVOKE public execute 後只 grant `authenticated`：

```sql
public.is_active_member(target_org uuid) returns boolean
public.has_org_role(target_org uuid, allowed_roles text[]) returns boolean
public.is_assigned_to_work_order(target_org uuid, target_work_order uuid) returns boolean
public.has_work_order_assignment_history(target_org uuid, target_work_order uuid) returns boolean
```

`is_assigned_to_work_order` 只接受 `assigned/accepted/checked_in`，供 mutation 授權；`has_work_order_assignment_history` 另含 `completed`，只供保固／歷史 read decision，避免重開工單時舊技師恢復寫入權。

內部以可信 JWT claim helper 取得 actor user id，再比對 active membership，避免每 row 重算。function 不接受任意 table name 或 SQL。

### 11.2 Policy 基準

| 資料 | SELECT | INSERT/UPDATE | DELETE |
|---|---|---|---|
| organizations | active member | owner/admin（部分欄位） | 禁止 |
| memberships | active member；technician 僅基本名單 | owner/admin；owner 角色受 RPC 保護 | 禁止，改 removed |
| CRM/request/project | manager roles 全部；技師僅 assigned work order 關聯 | owner/admin/dispatcher；技師不直改 | draft 由 manager，其他 soft delete/cancel |
| work_orders/assignments | manager 全部；技師僅自己被指派 | manager；技師只經 transition RPC | 禁止 |
| quotes/catalog/payments | owner/admin/dispatcher/accountant/viewer 依矩陣；技師無成本 | manager/accountant 依資源 | 只准 draft owner/admin |
| checklist/photos | assigned 技師與 manager | assigned 技師或 manager | manager；uploader 在未完成工單可 soft delete |
| events/attempts | 有資源可見權者 | 只經 function/worker insert | 全部禁止 |
| notifications | owner/admin/dispatcher；技師僅與自己工單相關的非敏感摘要 | worker／manager action | 禁止 |
| line_channels | owner/admin 可看非敏感 metadata | owner/admin API | 禁止 |

RLS 不是唯一授權層。API service 仍需檢查 role + resource + state；worker 使用 service role 時必須先由固定查詢取得 `organization_id`，不可接受 client 傳入後直接信任。

### 11.3 Storage policies

Private bucket `work-media`。object path：

```text
org/{organization_id}/work-orders/{work_order_id}/{photo_id}/original.webp
org/{organization_id}/work-orders/{work_order_id}/{photo_id}/thumb.webp
org/{organization_id}/service-requests/{request_id}/{photo_id}/original.webp
```

瀏覽器不直接 list bucket。上／下載一律由 API 驗權後簽發短效 URL；Storage policy 仍檢查 path org 與 active membership。禁止 public bucket。

## 12. 必要 transaction RPC

下列操作不可拆成多次 client writes：

- `create_organization_with_owner`
- `change_membership_role`
- `next_document_number`
- `triage_service_request`
- `convert_service_request`
- `get_pilot_service_request_detail` / `update_pilot_service_request_summary`
- `list_pilot_customers` / `list_pilot_customer_locations` / `list_pilot_customer_assets`
- `create_pilot_customer`
- `list_pilot_service_request_events`
- `list_pilot_assignable_members`
- `transition_work_order`
- `create_pilot_quote`
- `get_pilot_quote_workspace` / `get_pilot_quote_workspace_by_request`
- `save_pilot_quote_draft`（quote+version 與 canonical version-only overload）
- `approve_and_send_pilot_quote`
- `rotate_pilot_quote_public_token`
- `clone_pilot_quote_version`
- `consume_pilot_public_quote_rate_limit`（service-role-only；獨立 transaction 先消耗 IP/token budget）
- `resolve_pilot_public_quote` / `respond_pilot_public_quote`（service-role-only capability gateway）
- `send_change_order` / `respond_to_change_order_public`
- `mark_payment_paid` / `reverse_payment`
- `complete_work_order`
- `enqueue_notification`
- `claim_notifications`
- `claim_line_webhook_events`
- M7 worker（service_role）：`ingest_inbound_message`、`attach_message_media`、`record_extraction_run`、`create_intake_draft`、`claim_intake_extraction_runs`、`mark_extraction_succeeded`、`mark_extraction_failed`
- M7 staff（authenticated，內部 has_org_role gate）：`confirm_intake_draft`、`dismiss_intake_draft`

每個 exposed RPC 必須：驗證 `auth.uid()`（公開 token RPC 除外）、組織、role、狀態、lock version；固定 search_path；禁止 dynamic SQL；失敗時 raise 可映射的 domain error code。

Pilot staff route 不具 base-table privilege，也不得以 service role 補讀；detail/customer/event projection 由上述 authenticated-only RPC 回傳 allowlist JSON。`update_pilot_service_request_summary` 僅接受內容欄位、以 row lock 驗 `lock_version`、保留 `original_submission`，並在同一 transaction append `service_request.summary_updated` event。`create_pilot_customer` 驗 manager/tenant、以店家時區配發 `CU-YYYYMM-NNNNNN`，寫入 actor 並 append `customer.created`；events aggregate allowlist 因此包含 `customer`。

## 13. Index 與查詢驗證

### 13.1 共通 index 規則

- equality 欄位在前、range/sort 在後，例如 `(organization_id, status, scheduled_start_at, id)`。
- soft-delete list 使用 partial index `WHERE deleted_at IS NULL`。
- 所有 cursor sort 加 `id` 作 deterministic tie-breaker。
- JSONB 只有實際出現 containment query 才建 GIN；不為 metadata 預建昂貴 index。
- 大表新增 index 使用 `CREATE INDEX CONCURRENTLY`（不可置於 transaction migration）。

### 13.2 Merge gate

每個主要 list query 在 staging seed volume 下執行 `EXPLAIN (ANALYZE, BUFFERS)`：

- 不得對 tenant 大表做無條件 Seq Scan。
- 預估／實際 row 差距若超過 10 倍需檢查統計或 query。
- p95 DB time 目標 < 100 ms。
- CI 執行 unindexed FK 檢查與重複 index 檢查。

## 14. Migration 與 seed

初始 migration 建議順序：

1. extension、schemas、roles、共通 functions。
2. organizations、memberships。
3. CRM／LINE metadata。
4. requests、projects、work orders、assignments。
5. catalog、quotes、change orders、payments。
6. checklists、photos、events。
7. maintenance、notifications、private credentials、webhook inbox。
8. support tables、transaction RPC。
9. indexes、triggers、RLS／grants／storage policies。
10. pgTAP RLS 與 constraints tests。

`seed.sql` 建立：一個 demo 組織、六種角色、兩位客戶、三個地址、設備、各狀態 request/work order、兩版報價、追加單、付款節點、保養方案及失敗通知。只用明顯假資料；不得出現正式 LINE id、電話、地址或 token。

M7（`202607200008_v2_m7_intake_aggregation.sql`）接在 M6 之後：conversations／inbound_messages／message_attachments／intake_extraction_runs／intake_drafts、guard/append-only triggers、events allowlist 擴充、worker+staff RPC。沿用 M6 `line_webhook_events` 既有 dedup 落地列（不改 webhook edge）與 M2 photo pipeline 供 LINE image 下載。

## 15. Schema 驗收清單

- [ ] 空資料庫可用單一指令套用所有 v2 migrations。
- [ ] 每個 tenant table 有 `organization_id`、composite FK 與 RLS。
- [ ] `anon` 無法讀寫任何 domain table；公開流程只經 token-scoped API/RPC。
- [ ] A 組織使用者無法 SELECT／INSERT／UPDATE／RPC 觸及 B 組織。
- [ ] technician 只能看被指派工單及必要客戶／地址／設備資訊。
- [ ] 已送出 quote/change order item 無法 UPDATE/DELETE。
- [ ] event、attempt table 對 authenticated user 不可 UPDATE/DELETE。
- [ ] LINE credentials 無法由 PostgREST 或 SQL authenticated role 讀取。
- [ ] transaction RPC 失敗時 parent/items/event/outbox 全部回滾。
- [ ] cursor list query 命中預期 composite index。
- [ ] private media 無永久 public URL。
- [ ] M7：AI extraction 失敗仍以 `origin='manual'` 草稿落地，inbound 訊息完整、run 標 `failed`（降級 gate）。
- [ ] M7：同 sender 連續訊息聚合成一 open conversation、一 active draft；同 `line_message_id` 重送不建重複訊息。
- [ ] M7：`inbound_messages.raw/text_content` write-once；`intake_extraction_runs` append-only。
- [ ] M7：confirm 建 `service_request(source='line')`，重放回傳同一 request（confirm-once）；跨租戶 confirm 被拒。
