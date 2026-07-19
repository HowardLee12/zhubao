# Renoly v2 HTTP API 規格

> Base URL：`/api/v2`  
> Content type：`application/json; charset=utf-8`  
> v1 相容性：無  
> 本文件與 [資料庫規格](./database-spec.md) 共同構成後端 contract。

## 1. 共通契約

### 1.1 URL 與租戶

員工端 domain API 一律把租戶放在 path：

```text
/api/v2/organizations/{organizationId}/customers
```

不得只依 `X-Organization-ID`、client body 或目前選單判定租戶。server 必須同時檢查 path organization、session user 的 active membership，以及資源本身的 `organization_id`。跨租戶資源回 `404`，避免洩漏存在性。

例外：

- `/api/v2/session`：目前登入者。
- `/api/v2/public/*`：受限 token 客戶流程。
- `/api/v2/webhooks/line/*`：LINE provider webhook。
- `/api/v2/internal/workers/*`：排程 worker，僅 server-to-server。

### 1.2 認證

- 員工 API：Supabase Auth session，使用 `HttpOnly; Secure; SameSite=Lax` cookie。
- State-changing request 另帶 `X-CSRF-Token`；token 與 session 綁定。
- 客戶 API：URL 中的 opaque capability token；只可操作 token scope 指定資源。
- Worker API：`Authorization: Bearer <WORKER_SECRET>` + allowlisted deployment source；secret 定期輪替。
- LINE webhook：只信任 raw-body `X-Line-Signature`，不使用 cookie／CSRF。

### 1.3 JSON 格式

- request／response 欄位用 `camelCase`；DB mapping 用 `snake_case`。
- ID 是 UUID string。
- 時間點是 RFC 3339 UTC，例如 `2026-07-16T03:20:00Z`。
- 商業日期是 `YYYY-MM-DD`。
- `bigint` 金額以十進位字串傳輸，例如 `"2490"`，避免 JavaScript 精度流失。
- `numeric` 亦使用字串，例如 quantity `"1.500"`、taxRate `"0.0500"`。
- optional 欄位：未修改時省略；明確清空時傳 `null`。不得用空字串代替 null，除規格標示可空文字。
- 未定義欄位一律拒絕（Zod `.strict()`），避免拼錯欄位被靜默忽略。

### 1.4 成功回應

單筆：

```json
{
  "data": {
    "id": "be31ba9d-7509-4ebd-9e19-20e0860a502a",
    "organizationId": "86d25cd6-7874-42a7-9545-06ab70b3f4cb",
    "lockVersion": 3,
    "updatedAt": "2026-07-16T03:20:00Z"
  }
}
```

- Create：`201 Created` + `Location` header。
- Action 無 response body：`204 No Content`。
- Mutable aggregate GET/PATCH/POST response 帶 `ETag: "3"`。
- 每個 response 帶 `X-Request-ID`；如 client 傳合法 UUID request id 可沿用，否則 server 產生。

列表（keyset 深分頁；`meta` 為扁平結構，`nextCursor` 為 opaque base64 keyset cursor，綁定 tenant/route/sort/filter，到底時為 `null`）：

```json
{
  "data": [],
  "meta": {
    "nextCursor": null,
    "hasMore": false
  }
}
```

### 1.5 錯誤格式

採 RFC 7807 風格，content type `application/problem+json`：

```json
{
  "type": "https://renoly.app/problems/validation-failed",
  "title": "輸入資料不正確",
  "status": 422,
  "detail": "請修正標示欄位後再試一次。",
  "code": "VALIDATION_FAILED",
  "instance": "/api/v2/organizations/86d.../work-orders",
  "requestId": "67427c45-e326-4a0a-b7b7-82cf53999df7",
  "errors": [
    { "path": "scheduledEndAt", "code": "after_start", "message": "結束時間必須晚於開始時間" }
  ]
}
```

正式環境不得回 SQL、stack、provider raw body、secret 或其他租戶 id。

| HTTP | code | 使用時機 |
|---:|---|---|
| 400 | `MALFORMED_REQUEST` | JSON 無法解析、cursor 格式錯誤 |
| 401 | `AUTH_REQUIRED`, `SESSION_EXPIRED` | 無／失效 session |
| 403 | `FORBIDDEN`, `CSRF_INVALID` | 同租戶但角色不足、CSRF 失敗 |
| 404 | `RESOURCE_NOT_FOUND`, `PUBLIC_LINK_NOT_FOUND` | 不存在、跨租戶、token 無效／撤銷／到期 |
| 409 | `INVALID_STATE_TRANSITION` | 狀態不可轉換 |
| 409 | `IDEMPOTENCY_CONFLICT`, `IDEMPOTENCY_IN_PROGRESS` | key body 不同或尚在執行 |
| 409 | `SCHEDULE_CONFLICT`, `ACTIVE_VERSION_CHANGED` | 排程衝突、客戶回覆舊版 |
| 412 | `VERSION_CONFLICT` | `If-Match` 已過期 |
| 413 | `UPLOAD_TOO_LARGE` | 檔案超限 |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | 格式不接受 |
| 422 | `VALIDATION_FAILED`, `BUSINESS_RULE_FAILED` | schema／前置條件失敗 |
| 428 | `IF_MATCH_REQUIRED` | mutation 缺 ETag |
| 429 | `RATE_LIMITED` | 帶 `Retry-After` |
| 500 | `INTERNAL_ERROR` | 未預期錯誤 |
| 502/503 | `PROVIDER_UNAVAILABLE` | 外部依賴暫時失敗；一般 outbox 發送不會同步回此錯誤 |

### 1.6 Cursor pagination

共同 query：

| 參數 | 預設 | 規則 |
|---|---:|---|
| `limit` | 20 | `1..100` |
| `cursor` | 無 | server 產生的 opaque base64url + HMAC；client 不解析 |
| `sort` | resource 預設 | 僅接受 endpoint allowlist |
| `q` | 無 | trim 後 `2..100`；只搜尋明列欄位 |

預設使用 keyset pagination，例如 `(created_at DESC, id DESC)`。cursor 綁定 organization、route、sort 與 filter hash；修改 filter 後不得沿用舊 cursor，否則回 400。`meta.total` 預設不回傳；需要精確計數的 UI 使用獨立統計 endpoint。

### 1.7 Optimistic concurrency

以下 aggregate mutation 必須帶最近一次 GET 得到的 `If-Match: "{lockVersion}"`：service request、project、work order、quote、change order、payment milestone、maintenance plan、organization、membership。

- 缺少：428。
- DB `lock_version` 不一致：412，response 可含最新 `lockVersion`，不可包含未授權資料。
- checklist item、quote draft item 等 child bulk update 以 parent ETag 保護。

### 1.8 Idempotency

所有 create POST 建議、以下 POST 強制 `Idempotency-Key`：

- public intake
- service request convert
- quote／change order send 或客戶回覆
- work order transition／complete
- payment mark-paid／reverse
- photo complete
- notification retry

格式：`8..128` 個 `[A-Za-z0-9._:-]`。scope 為 actor + organization + method + route template；server 儲存 canonical body SHA-256。

- 同 key／同 body：重播首次 status、headers、body，不重做副作用。
- 同 key／不同 body：409 `IDEMPOTENCY_CONFLICT`。
- 前一 request 執行中：409 + `Retry-After: 1`。
- 一般 key 保留 24 小時；客戶接受、付款異動保留 30 天。

## 2. 角色縮寫

下列六個值是技術層 canonical role allowlist；Phase 1 UI 與 seed 只開放 `owner`、`dispatcher`、`technician`。`admin`、`accountant`、`viewer` 是預留角色，待真實試點證明需要後才可由店家指派。這讓 API/RLS 可先定義最小權限，卻不把額外概念帶進 MVP 導入流程。

Endpoint 表使用：

- `O` owner
- `A` admin
- `D` dispatcher
- `T` technician（通常限自己的 assignment）
- `C` accountant
- `V` viewer（唯讀）
- `P` valid public capability token
- `W` trusted worker

角色仍需通過資源級檢查；「可呼叫」不代表可存取同組織所有資源。

## 3. Session 與組織

| Method | Path | 角色 | 說明 |
|---|---|---|---|
| GET | `/session` | 登入者 | 回 user 與 active memberships；不回 auth provider token |
| POST | `/organizations` | 登入者 | 建組織與 owner membership；Idempotency-Key |
| GET | `/organizations/{orgId}` | O/A/D/T/C/V | 組織摘要 |
| PATCH | `/organizations/{orgId}` | O/A | 更新名稱、時區、模板、低風險設定；If-Match |
| GET | `/organizations/{orgId}/memberships` | O/A/D/T/C/V | T/V 僅回 id、displayName、role、status |
| GET | `/organizations/{orgId}/members` | O/A/D | Pilot 指派下拉專用；只回 active O/A/D/T 的 id、displayName、role、status |
| POST | `/organizations/{orgId}/memberships` | O/A | 邀請；Idempotency-Key |
| PATCH | `/organizations/{orgId}/memberships/{id}` | O/A | 改顯示資料；改 role/status 走 actions；If-Match |
| POST | `.../memberships/{id}/actions/change-role` | O/A | 不可移除最後 owner；If-Match |
| POST | `.../memberships/{id}/actions/suspend` | O/A | 不可 suspend 最後 owner；If-Match |
| POST | `.../memberships/{id}/actions/restore` | O/A | 恢復 active；If-Match |

建立組織：

```json
{
  "name": "北城工程",
  "slug": "north-city-service",
  "industryTemplate": "general_field_service",
  "timezone": "Asia/Taipei",
  "currency": "TWD"
}
```

`201` 回 organization 與 owner membership。slug 衝突回 409 `SLUG_TAKEN`。

## 4. Customers、locations、assets

| Method | Path | 角色 | 規格摘要 |
|---|---|---|---|
| GET/POST | `/organizations/{orgId}/customers` | O/A/D | Pilot 已實作：GET `q,limit`；POST `{name,phone?}` 建立真實 customer、店內流水號與稽核事件 |
| GET | `.../customers/similar` | O/A/D | triage 重複客戶 hint；query `phone`／`name`（至少一項）；tenant-scoped、hint-only 不自動合併 |
| GET/PATCH/DELETE | `.../customers/{customerId}` | GET O/A/D/C/V/T*；write O/A/D | T 僅可讀 assigned work order 客戶；DELETE soft delete，If-Match |
| GET/POST | `.../customers/{customerId}/locations` | O/A/D/V；T* read | 建立地址；POST If customer 未有 default，server 自動設 default |
| GET | `.../customers/{customerId}/assets` | O/A/D | Pilot triage 用 customer-scoped 設備清單 |
| GET/PATCH/DELETE | `.../locations/{locationId}` | O/A/D；V/T* read | DELETE 有 active work order 時回 409 |
| GET/POST | `.../locations/{locationId}/assets` | O/A/D；T* read | filter `status,assetType` |
| GET/PATCH/DELETE | `.../assets/{assetId}` | O/A/D；T* read | DELETE 等同 retired/soft delete，保留履歷 |
| GET | `.../assets/{assetId}/history` | O/A/D/T*/V | cursor 合併 work orders、photos/events 摘要 |

Customer create：

```json
{
  "kind": "individual",
  "name": "王先生",
  "phone": "+886912345678",
  "email": null,
  "source": "phone",
  "tags": ["住宅"],
  "notes": ""
}
```

Response 不預設展開 locations/assets；使用 `?include=defaultLocation` 時最多展開 allowlist 關聯，禁止任意 GraphQL 式 include。

目前 M3 詳情頁的 inline create 採最小且已實作的 body：

```json
{ "name": "王先生", "phone": "+886912345678" }
```

伺服器固定建立 `individual/manual` customer，於同一 transaction 配發 `CU-YYYYMM-NNNNNN`、寫 actor 與 `customer.created` event，再回真實 UUID；不再使用 provisional 前端字串。上方完整 customer create 為後續 CRM CRUD 目標合約。

## 5. Service requests

| Method | Path | 角色 | 規格摘要 |
|---|---|---|---|
| GET/POST | `/organizations/{orgId}/service-requests` | O/A/D；POST 為後續 | Pilot GET 已實作 `status,cursor,limit`；staff POST 仍是目標合約 |
| GET/PATCH | `.../service-requests/{id}` | O/A/D | M3 manager workspace；PATCH 僅摘要內容，不可直接改 status；If-Match |
| POST | `.../{id}/actions/triage` | O/A/D | 綁 customer/location/asset、負責人；If-Match |
| POST | `.../{id}/actions/start-quoting` | O/A/D | new 必須先 triage |
| POST | `.../{id}/actions/mark-quoted` | O/A/D | 需 sent quote version |
| POST | `.../{id}/actions/convert` | O/A/D | 原子建立 project/work order；Idempotency + If-Match |
| POST | `.../{id}/actions/decline` | O/A/D | `{reason}`；If-Match |
| POST | `.../{id}/actions/cancel` | O/A/D | `{reason}`；If-Match |
| GET | `.../{id}/events` | O/A/D | `afterSequence,limit`；回 redacted append-only timeline |
| GET | `.../{id}/photos` | O/A/D | 回 private storage 短效 signed URL，不回 storage path |

目前 Pilot 的 detail/PATCH、customer/location/asset confirmation list 與 events 皆透過 caller session 的 authenticated-only RPC；HTTP route 不得以 service role 直接查 domain table。PATCH 在 DB transaction 內驗 optimistic lock、留下摘要編輯者／時間與 append-only event；回應重新帶回完整時段與已簽照片，而非局部空陣列。

建立需求：

```json
{
  "source": "phone",
  "contactName": "王先生",
  "contactPhone": "+886912345678",
  "subject": "主臥冷氣不冷",
  "description": "運轉約十分鐘後只出風",
  "priority": "normal",
  "requestedTimeWindows": [
    { "startsAt": "2026-07-18T01:00:00Z", "endsAt": "2026-07-18T04:00:00Z", "preferenceRank": 1 }
  ],
  "customerId": null,
  "locationId": null,
  "assetId": null
}
```

Triage request（綁定 context，`new → triaged`；`customerId` 必填，`locationId`／`assetId` 必屬同一 customer；`assignedMemberId` 僅能是 active owner/admin/dispatcher/technician；`internalNote` 為 staff-only 且會持久化；其餘為選填覆寫）：

```json
{
  "customerId": "5f6a...",
  "locationId": "8b1c...",
  "assetId": null,
  "assignedMemberId": "39796c68-3cd0-4aea-a8eb-b95f062e70c8",
  "priority": "high",
  "category": "cooling",
  "internalNote": "已確認為住宅案"
}
```

相似客戶 hint（`GET .../customers/similar?phone=&name=`）回 hint-only 陣列（無 `meta`），dispatcher 明確選連結既有或建立新，不自動合併：

```json
{
  "data": [
    { "customerId": "5f6a...", "customerNo": "C-000123", "name": "王先生", "phone": "+886912345678", "matchReason": "phone" }
  ]
}
```

Convert request：

```json
{
  "mode": "singleVisit",
  "workOrder": {
    "title": "檢查主臥冷氣",
    "scheduledStartAt": "2026-07-18T01:00:00Z",
    "scheduledEndAt": "2026-07-18T03:00:00Z"
  }
}
```

`mode`：`singleVisit` 只建 work order；`project` 建 project（`projectTitle` 選填），可同時以 `workOrder` 建首張工單。`workOrder` 為兩種 mode 共用的唯一輸入。M3 尚未在 conversion transaction 寫 assignment，因此 API 會拒絕 `assigneeMembershipIds`，不會假裝成功。response 為標準 `{ "data": { serviceRequest, project|null, workOrder|null, replayed } }`；同一進件重送相同 `Idempotency-Key` 時 `replayed=true` 且回既有 case，不重複建立。

## 6. Public intake

| Method | Path | 認證 | 說明 |
|---|---|---|---|
| GET | `/public/intake/{token}` | P | 店家品牌、表單 schema、可選服務；不回內部資料 |
| POST | `/public/intake/{token}/service-requests` | P | 建 request；Idempotency-Key 強制 |
| POST | `/public/intake/{token}/photo-uploads` | P | 建 pending intake photo + signed upload URL |
| POST | `/public/intake/{token}/photos/{photoId}/complete` | P | 驗證 token、photo parent 與 object；Idempotency-Key |

Public create 額外要求 CAPTCHA／risk token（連續濫用時必填）、honeypot 與 IP/token rate limit。成功回 `202 Accepted`：

```json
{
  "data": {
    "requestReference": "SR-202607-000123",
    "status": "received",
    "nextStep": "店家確認後會透過 LINE 或電話聯絡"
  }
}
```

不回內部 UUID、assigned member 或其他客戶資料。

## 7. Projects

| Method | Path | 角色 | 規格摘要 |
|---|---|---|---|
| GET/POST | `/organizations/{orgId}/projects` | O/A/D/C/V；POST O/A/D | filter `status,customerId,ownerMemberId,startFrom,startTo,q` |
| GET/PATCH | `.../projects/{id}` | GET O/A/D/C/V/T*；PATCH O/A/D | PATCH 內容／日期，不改 status；If-Match |
| POST | `.../projects/{id}/actions/activate` | O/A/D | If-Match |
| POST | `.../projects/{id}/actions/hold` | O/A/D | `{reason}`；If-Match |
| POST | `.../projects/{id}/actions/resume` | O/A/D | If-Match |
| POST | `.../projects/{id}/actions/complete` | O/A/D | 未完工單需 `{overrideReason}` 且 O/A；If-Match |
| POST | `.../projects/{id}/actions/cancel` | O/A | `{reason}`；If-Match |
| GET | `.../projects/{id}/summary` | O/A/D/C/V/T* | 工單／報價／追加／請款聚合 DTO，無 N+1 |

## 8. Work orders、assignments、schedule

| Method | Path | 角色 | 規格摘要 |
|---|---|---|---|
| GET/POST | `/organizations/{orgId}/work-orders` | O/A/D/V/T*；POST O/A/D | filter `status,assigneeId,projectId,customerId,assetId,scheduledFrom,scheduledTo,priority,q` |
| GET/PATCH | `.../work-orders/{id}` | GET O/A/D/V/T*；PATCH O/A/D/T* | T 只能 assigned 且只可改現場備註／完工摘要；PATCH 不改 status/schedule；If-Match |
| POST | `.../work-orders/{id}/actions/schedule` | O/A/D | 時段與 `assignments[{membershipId,duty?}]`（1..20）＋必填 `occurredAt`；可 `conflictOverrideReason`；If-Match；回 `{data, notification}` |
| POST | `.../work-orders/{id}/actions/transition` | O/A/D/T* | action allowlist；Idempotency + If-Match；回 `{data, notification}` |
| GET/POST | `.../work-orders/{id}/assignments` | O/A/D/T* read；write O/A/D | POST Idempotency |
| PATCH | `.../assignments/{assignmentId}` | O/A/D | duty；If-Match |
| POST | `.../assignments/{id}/actions/respond` | T 本人 | `{decision:"accept"|"decline",reason?}`；Idempotency |
| DELETE | `.../assignments/{id}` | O/A/D | body 必填 `{reason}`；實際轉 cancelled 並回該 assignment；If-Match |
| GET | `/organizations/{orgId}/schedule` | O/A/D/V/T* | filter 時間必填、最大 31 日；T 僅自己 |
| POST | `/organizations/{orgId}/schedule/conflict-check` | O/A/D | 批次候選時段，最多 50 筆；回 `{data:{conflicts}}` |

Create work order：

```json
{
  "projectId": null,
  "serviceRequestId": "fcb8300e-926c-44c6-957a-cf742bdd4cdf",
  "customerId": "7c691bbd-26f0-41fa-8467-b7023fcb1833",
  "locationId": "359612a9-dfd2-4cf7-83dc-e172f56c2255",
  "assetId": "01d91285-686f-4dde-b742-cf90f8a50bf2",
  "title": "冷氣檢查與清洗",
  "description": "先檢測再由客戶確認加修",
  "priority": "normal",
  "scheduledStartAt": null,
  "scheduledEndAt": null
}
```

Transition：

```json
{
  "action": "complete",
  "occurredAt": "2026-07-18T04:10:00Z",
  "completionSummary": "完成清洗與排水測試，運轉正常",
  "customerSignoffName": "王先生",
  "overrideReason": null
}
```

Action allowlist：`dispatch/enRoute/arrive/pause/resume/complete/cancel/reopen`。server 依 action、目前 status 與角色決定 next state，client 不傳目標 `status`。`occurredAt` 不得晚於現在 5 分鐘；早於 24 小時時僅 O/A 可帶 `overrideReason` 補登，且最久只能回溯 30 天。超出硬邊界回 `OCCURRED_AT_OUT_OF_RANGE`，不可覆寫。

`schedule` 與 `transition`（以及 force-complete）成功回應為 `{ "data": <workOrder detail>, "notification": { "status": "not_sent", "reason": "line_delivery_deferred_to_m6" } }`。M5 尚未送出 LINE 通知，envelope 誠實標示 `not_sent`，UI 不得暗示已發送。

排程衝突預設回 409（每筆含 `workOrderNo`）：

```json
{
  "code": "SCHEDULE_CONFLICT",
  "status": 409,
  "conflicts": [
    {
      "membershipId": "39796c68-3cd0-4aea-a8eb-b95f062e70c8",
      "workOrderId": "9931f1ce-707f-4bf5-a938-e0160f65b1e5",
      "workOrderNo": "WO-2026-0007",
      "startsAt": "2026-07-18T01:30:00Z",
      "endsAt": "2026-07-18T03:30:00Z"
    }
  ]
}
```

`conflict-check`（非變更操作，但因 body 帶候選名單而做 CSRF 保護）回 `{ "data": { "conflicts": [ … ] } }`，每筆 conflict 與 409 相同欄位；沒有 `hasConflicts` 旗標，呼叫端以陣列長度判斷。

## 9. Checklists、photos、events

| Method | Path | 角色 | 規格摘要 |
|---|---|---|---|
| GET/POST | `/organizations/{orgId}/checklist-templates` | O/A/D/V；POST O/A/D | template CRUD；不可影響既有 snapshot |
| GET/PATCH | `.../checklist-templates/{id}` | GET O/A/D/V；PATCH O/A/D | PATCH If-Match；使用中改版仍只改 template |
| POST | `.../work-orders/{id}/checklists` | O/A/D | 由 template 或 inline 建 snapshot |
| GET | `.../work-orders/{id}/checklists` | O/A/D/V/T* | T assigned |
| PATCH | `.../work-order-checklists/{id}/items/{itemId}` | O/A/D/T* | 更新 response；If-Match checklist parent |
| POST | `.../work-order-checklists/{id}/actions/complete` | O/A/D/T* | 驗 required/evidence；Idempotency + If-Match |
| POST | `.../work-orders/{id}/photo-uploads` | O/A/D/T* | pending row + signed PUT |
| POST | `.../service-requests/{id}/photo-uploads` | O/A/D | 同上 |
| POST | `.../photos/{photoId}/complete` | uploader／manager | 驗 object；Idempotency |
| GET/PATCH/DELETE | `.../photos/{photoId}` | 有 parent 權限者 | GET metadata + short read URL；PATCH caption；DELETE soft |
| GET | `.../{resource}/{id}/events` | 有資源權限者 | cursor；resource allowlist |

Photo upload request：

```json
{
  "category": "before",
  "filename": "IMG_1001.jpg",
  "contentType": "image/jpeg",
  "byteSize": 1834021,
  "sha256": "b4d0f62b32bb8c1993d4af87d7d76d9a8d28a09af0a039094765634a6e60cc62",
  "capturedAt": "2026-07-18T02:03:00Z",
  "checklistItemId": null
}
```

Response `201`：

```json
{
  "data": {
    "photoId": "0fc3f3bf-4966-422a-a719-a52a64e662cf",
    "upload": {
      "method": "PUT",
      "url": "https://storage.example/signed/...",
      "headers": { "content-type": "image/jpeg" },
      "expiresAt": "2026-07-18T02:13:00Z"
    }
  }
}
```

signed URL 不可寫入 log。Complete 成功可回 `202`（仍 processing）；client poll photo GET 或使用 bounded revalidation。

## 10. Service catalogs

| Method | Path | 角色 | 規格摘要 |
|---|---|---|---|
| GET/POST | `/organizations/{orgId}/service-catalogs` | O/A/D/V/T；POST O/A/D | list/catalog create |
| GET/PATCH | `.../service-catalogs/{id}` | GET O/A/D/V/T；PATCH O/A/D | T response 不含 defaultCostMinor；PATCH If-Match |
| GET/POST | `.../service-catalogs/{id}/items` | O/A/D/V/T | T 不含成本；filter `active,category,q` |
| GET/PATCH/DELETE | `.../service-catalog-items/{id}` | O/A/D；V/T read | DELETE 設 inactive，歷史快照不變 |
| POST | `.../service-catalogs/{id}/items:bulk-upsert` | O/A/D | 最多 200，逐列錯誤；整批 atomic |

Catalog item request 金額用字串：`{"name":"分離式冷氣清洗","unit":"台","defaultCostMinor":"700","defaultPriceMinor":"1800","taxRate":"0.0000"}`。

## 11. Quotes

M4 Pilot 已接線的 surface 如下；所有 staff response 使用 `PilotQuoteWorkspace`，同時回 quote、當前 version、request ETag、customer 與 location 摘要：

| Method | Path | 角色 | 規格摘要 |
|---|---|---|---|
| POST | `/organizations/{orgId}/quotes` | O/A/D | 原子建立 request 唯一 quote + v1；request If-Match + Idempotency |
| GET | `.../quotes/{id}` | O/A/D | 取得店內 quote workspace；包含成本與內部備註 |
| GET | `.../service-requests/{id}/quote` | O/A/D | 從進件重開其唯一 quote；沒有時 404 |
| PATCH | `.../quote-versions/{versionId}` | O/A/D | 原子取代 draft 欄位與全部 items；最多 300；quote If-Match |
| POST | `.../quotes/{id}/versions` | O/A/D | rejected version 複製為 vNext draft；If-Match + Idempotency |
| POST | `.../quotes/{id}/actions/send` | O/A | `{versionId,serviceRequestLockVersion}`；人工核准、鎖版本、建 hash-only token；If-Match + Idempotency |
| POST | `.../quotes/{id}/actions/rotate-public-link` | O/A | 撤銷舊連結並回傳新 URL；相同 Idempotency-Key replay 回完全相同 URL；If-Match |
| GET | `/public/quotes/current` | P | `Authorization: Bearer <capability>`；sanitized active version；共享 IP+token 限流；記 first view（idempotent） |
| POST | `/public/quotes/current/responses` | P | bearer capability；accept/reject；共享限流 + Idempotency-Key |

列表、quote aggregate PATCH/cancel、獨立 item route、多人 submit/approve/reject-approval workflow 與通知 channel 是完整目標合約，尚未列入 M4 Pilot 可操作 surface。M4 的 send 不 enqueue LINE；API 回傳安全 URL，由 owner 手動貼入既有對話，M6 才接通知 outbox。

Create quote：

```json
{
  "serviceRequestId": "fcb8300e-926c-44c6-957a-cf742bdd4cdf",
  "customerId": "7c691bbd-26f0-41fa-8467-b7023fcb1833",
  "locationId": "359612a9-dfd2-4cf7-83dc-e172f56c2255",
  "currency": "TWD",
  "version": {
    "title": "冷氣檢查與清洗報價",
    "validUntil": "2026-07-25",
    "customerNotes": "現場若發現零件故障，另行報價確認。",
    "internalNotes": "熟客；成本不可外流。",
    "terms": "完工後轉帳付款。",
    "items": [
      {
        "serviceCatalogItemId": null,
        "groupName": "清洗",
        "name": "分離式冷氣清洗",
        "specification": "含基本排水測試",
        "unit": "台",
        "quantity": "1.000",
        "unitCostMinor": "700",
        "unitPriceMinor": "1800",
        "discountMinor": "0",
        "taxRate": "0.0000",
        "sortOrder": 10
      }
    ]
  }
}
```

Client 不傳 subtotal/tax/total；TypeScript domain 先驗算，PostgreSQL trigger/RPC 再以整數／numeric 權威重算。owner/admin 在同一 transaction 執行 approve-and-send；dispatcher 可存草稿但不可繞過核准。送出後 version 與 items 均不可 UPDATE/DELETE；修訂只能建立新版。

Public DTO 範例：

```json
{
  "data": {
    "merchant": { "name": "北城工程", "phone": "+886223456789" },
    "quoteNo": "Q-202607-000123",
    "versionNo": 2,
    "status": "sent",
    "validUntil": "2026-07-25",
    "title": "冷氣檢查與清洗報價",
    "items": [
      { "name": "分離式冷氣清洗", "unit": "台", "quantity": "1.000", "unitPriceMinor": "1800", "totalMinor": "1800" }
    ],
    "subtotalMinor": "1800",
    "discountMinor": "0",
    "taxMinor": "0",
    "totalMinor": "1800",
    "currency": "TWD",
    "customerNotes": "現場若發現零件故障，另行報價確認。",
    "terms": "完工後轉帳付款。",
    "decision": null
  }
}
```

永不包含成本、markup、internal notes、member ids。客戶 response：

```json
{
  "decision": "accept",
  "displayName": "王先生",
  "comment": "請安排週六上午"
}
```

版本由 bearer token 綁定，client 不傳也看不到內部 version UUID。只可回覆當下 active version；舊 capability 回統一無法使用或 409 `ACTIVE_VERSION_CHANGED` 並要求重新開啟店家提供的新連結。店家取得的客戶 URL 為 `/public/quotes#<capability>`；fragment 不會進 HTTP request line，browser 再以 Authorization header 呼叫上述固定 API path。

## 12. Change orders

| Method | Path | 角色 | 規格摘要 |
|---|---|---|---|
| GET/POST | `/organizations/{orgId}/change-orders` | O/A/D/C/V；POST O/A/D | filter `projectId,status,kind`；draft + items atomic |
| GET/PATCH | `.../change-orders/{id}` | GET O/A/D/C/V；PATCH O/A/D | PATCH draft only；If-Match |
| PUT | `.../change-orders/{id}/items` | O/A/D | draft only；atomic；If-Match |
| POST | `.../change-orders/{id}/actions/send` | O/A/D | public token + outbox；Idempotency + If-Match |
| POST | `.../change-orders/{id}/actions/cancel` | O/A/D | reason；If-Match |
| GET | `/public/change-orders/{token}` | P | sanitized data |
| POST | `/public/change-orders/{token}/responses` | P | accept/reject；Idempotency |

接受不是宣稱符合特定電子簽章法規；保存 token scope、版本內容、display name、時間、IP hash、user-agent 摘要及 event，UI 稱「簽認紀錄」。

## 13. Payment milestones

| Method | Path | 角色 | 規格摘要 |
|---|---|---|---|
| GET/POST | `/organizations/{orgId}/payment-milestones` | O/A/D/C/V；POST O/A/D/C | filter `projectId,status,dueFrom,dueTo` |
| GET/PATCH | `.../payment-milestones/{id}` | GET O/A/D/C/V；PATCH O/A/C | PATCH pending/invoiced fields；If-Match |
| POST | `.../{id}/actions/invoice` | O/A/D/C | If-Match + Idempotency |
| POST | `.../{id}/actions/mark-paid` | O/A/C | paymentMethod, paidAt, externalReference；If-Match + Idempotency |
| POST | `.../{id}/actions/waive` | O/A/C | reason；If-Match |
| POST | `.../{id}/actions/reverse-payment` | O/A | reason 必填；If-Match + Idempotency |
| POST | `.../{id}/actions/cancel` | O/A/C | reason；If-Match |

`mark-paid` 僅記錄收款，不呼叫金流。禁止傳卡號、CVV、網銀密碼等；疑似敏感欄位直接 422 並寫安全事件（不記內容）。

## 14. Maintenance plans

| Method | Path | 角色 | 規格摘要 |
|---|---|---|---|
| GET/POST | `/organizations/{orgId}/maintenance-plans` | O/A/D/V；POST O/A/D | filter `status,dueBefore,assetId,customerId` |
| GET/PATCH | `.../maintenance-plans/{id}` | GET O/A/D/V；PATCH O/A/D | If-Match |
| POST | `.../{id}/actions/pause` | O/A/D | If-Match |
| POST | `.../{id}/actions/resume` | O/A/D | nextDueOn；If-Match |
| POST | `.../{id}/actions/complete` | O/A/D | last work order、next due；If-Match + Idempotency |
| POST | `.../{id}/actions/cancel` | O/A/D | reason；If-Match |
| POST | `/organizations/{orgId}/maintenance-reminders:prepare` | O/A/D | 只建 notification drafts，最多 100；Idempotency |

Cron 可準備草稿，但正式發送需 owner/admin/dispatcher 批次核准：`POST /notifications:approve`。

## 15. Notifications

| Method | Path | 角色 | 規格摘要 |
|---|---|---|---|
| GET | `/organizations/{orgId}/notifications` | O/A/D | filter `status,channel,relatedType,relatedId,scheduledFrom` |
| GET | `.../notifications/{id}` | O/A/D | redacted provider info + attempts |
| POST | `.../notifications:approve` | O/A/D | 最多 100 個 pending draft ids；Idempotency |
| POST | `.../notifications/{id}/actions/retry` | O/A/D | failed only；Idempotency；server transaction 鎖 row |
| POST | `.../notifications/{id}/actions/cancel` | O/A/D | pending/failed only |

一般 quote/work-order action 自動 enqueue 的交易通知不需第二次核准；maintenance 行銷／回訪預設需要人工核准與 consent check。

## 16. LINE channels 與 webhook

| Method | Path | 角色 | 規格摘要 |
|---|---|---|---|
| GET/POST | `/organizations/{orgId}/line-channels` | O/A | POST 綁定 credentials；Idempotency |
| GET/PATCH | `.../line-channels/{id}` | O/A | 只回非敏感 metadata；If-Match |
| POST | `.../line-channels/{id}/actions/verify` | O/A | server 呼叫 provider 驗證 token；不回 token |
| POST | `.../line-channels/{id}/actions/rotate-token` | O/A | body 新 token；覆寫加密值；If-Match + Idempotency |
| POST | `.../line-channels/{id}/actions/disable` | O/A | If-Match |
| POST | `/webhooks/line/{lineChannelId}` | LINE | raw body signature；快速 200 |

Create channel request：

```json
{
  "name": "北城工程官方帳號",
  "channelId": "2000000000",
  "channelSecret": "<write-only>",
  "channelAccessToken": "<write-only>",
  "liffId": null
}
```

Response：

```json
{
  "data": {
    "id": "f51f03fa-341a-4703-9c93-156212e1b163",
    "name": "北城工程官方帳號",
    "channelId": "2000000000",
    "status": "pending",
    "credentialVersion": 1,
    "webhookUrl": "https://app.renoly.example/api/v2/webhooks/line/f51f03fa-341a-4703-9c93-156212e1b163"
  }
}
```

不得回 masked secret（長度也可能洩漏）；只顯示 `credentialConfigured: true`。Webhook 規則：

1. 讀 raw bytes，依 channel credential 計算 HMAC-SHA256，constant-time 比對 signature。
2. 驗證 destination/channel、body 大小（上限 1 MB）與事件數（上限 100）。
3. insert `line_webhook_events`，unique event id 去重。
4. 無論新事件或重送皆回 `200 {"ok":true}`；簽章錯誤回 401，且不 parse／落庫 payload。
5. 不在 webhook request 內下載圖片或建立複雜 domain aggregate。

## 17. Dashboard 與 reporting

| Method | Path | 角色 | 說明 |
|---|---|---|---|
| GET | `/organizations/{orgId}/dashboard` | O/A/D/C/V | query `from,to` 最大 366 日；四 KPI + 待處理摘要 |
| GET | `/organizations/{orgId}/reports/funnel` | O/A/D/C/V | request→quote→accept→complete funnel |
| GET | `/organizations/{orgId}/reports/operations` | O/A/D/V | response time、completion、technician load；不做員工敏感排名預設展示 |
| GET | `/organizations/{orgId}/reports/retention` | O/A/D/V | maintenance due、reminder→booking conversion |

KPI 定義必須固定：

- 回覆速度：`service_request.created_at → first triaged/commented event` median/p90。
- 報價接受率：期間內 first sent quote 中 accepted / resolved sent；排除 cancelled。
- 完工率：scheduled work orders 中 completed / (completed + cancelled + overdue open)，需回 denominator。
- 回訪率：maintenance reminder 發送後 30 日內產生關聯 service request/work order 的 unique customer 比率。

Response 同時回 numerator、denominator、window 與 timezone，不只回百分比。

## 18. Internal worker API

| Method | Path | 角色 | 功能 |
|---|---|---|---|
| POST | `/internal/workers/notifications:dispatch` | W | claim + 發送一批，body `{limit:1..50}` |
| POST | `/internal/workers/line-webhooks:process` | W | claim + 處理 inbox |
| POST | `/internal/workers/maintenance:scan` | W | org-timezone due scan，建立待核准 drafts |
| POST | `/internal/workers/payments:mark-overdue` | W | idempotent 狀態更新 |
| POST | `/internal/workers/media:cleanup` | W | pending/deleted cleanup |
| POST | `/internal/workers/tokens:cleanup` | W | expired token/key cleanup |

Worker response 只回計數與 request id，不回 payload／recipient：

```json
{ "data": { "claimed": 20, "succeeded": 18, "retried": 1, "failed": 1 } }
```

## 19. DTO 暴露規則

| 欄位類型 | O/A | D | T | C | V | Public |
|---|---:|---:|---:|---:|---:|---:|
| 客戶基本聯絡 | ✓ | ✓ | assigned only | 必要時 | ✓ | 自己的 snapshot |
| 地址／門禁備註 | ✓ | ✓ | assigned only | — | ✓ | 該交易必要部分 |
| item cost／margin | ✓ | ✓ | — | ✓ | 設定可選，預設 — | — |
| 售價／應收 | ✓ | ✓ | 工作必要時 | ✓ | ✓ | 自己的交易 |
| internal notes | ✓ | ✓ | work-order technician note only | 財務必要時 | — | — |
| LINE credentials/token | — | — | — | — | — | — |
| provider raw response | — | — | — | — | — | — |

Repository row 不得直接 `NextResponse.json(row)`；每個 resource 必須有明確 mapper，public mapper 另寫且不可共用 internal DTO 後再「刪欄位」。

## 20. API 驗收條件

- [ ] OpenAPI 3.1 可由 Zod schema 產生，request/response contract test 與此文件一致。
- [ ] 所有 write route 有 authentication、CSRF（適用時）、role、resource tenant、state、schema 五層檢查。
- [ ] 所有 list route cursor deterministic，limit 上限 100，無未限制 scan。
- [ ] Aggregate mutation 使用 ETag；強制 action 使用 Idempotency-Key。
- [ ] Cross-table create/transition 在單一 transaction；event/outbox 同 commit。
- [ ] Public response 永不含成本、內部備註、其他客戶或員工資料。
- [ ] Webhook 可安全處理 duplicate、out-of-order、invalid signature 與 provider retry。
- [ ] Photo upload 驗證大小、magic bytes、parent authorization，且 bucket private。
- [ ] 錯誤 response 不含 stack、SQL、secret、signed URL 或 provider raw body。
