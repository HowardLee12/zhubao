# ADR 0004：人工分流與轉換採專用 RPC，triage relink 不刪 provisional customer

- 狀態：Accepted
- 日期：2026-07-19

## 背景

M3 落地人工分流（triage）與轉換（convert）兩條路徑：

- triage 需在單一 transaction 內綁定 `customer_id/location_id/asset_id`、指派負責人、設定 priority/category，並將 `new → triaged`，同時保證租戶隔離、role、狀態與 optimistic concurrency（lock version）。
- convert 需在單一 transaction 內取號、建立 project／work order、複製服務型錄與 checklist 模板快照（copy-by-value），並保證「同一進件只能轉一次」。

既有 `transition_service_request`（`202607160003_v2_security_and_rpcs.sql`）已存在，作為 status-only primitive，處理 `decline/cancel/start-quoting/mark-quoted`。問題是：是否把 triage/convert 這些「帶副作用與多表寫入」的操作擠進 `transition_service_request`，還是新增專用 RPC。

pilot 公開進件（`submit_pilot_service_request`）在客戶尚未被辨識時，會自動建立 provisional 的 customer/location 作為 source evidence。triage 時 dispatcher 可能改綁到既有真實 customer，於是產生「舊 provisional row 何去何從」的問題。

`docs/database-spec.md §12` 已把 `triage_service_request` 與 `convert_service_request` 列為必要 transaction RPC；`docs/api-spec.md §5` 已定義對應 endpoint。openapi 合約先前的 `TriageServiceRequestRequest`（只有 priority/category）與 `ConvertServiceRequestRequest`（`projectTitle/createInitialWorkOrder/workOrderTitle`）與上述資料層意圖漂移。

## 決策

### 1. RPC 命名：採 spec 名，不擴充 status primitive

- 新增 `triage_service_request(target_org, target_request, expected_lock_version, p_customer_id, p_location_id, p_asset_id, p_assigned_member_id, p_priority, p_category, …)`。
- 新增 `convert_service_request(target_org, target_request, expected_lock_version, p_mode, p_project_title, p_work_order jsonb, …)` 回傳 `ConversionEnvelope`。
- `transition_service_request` 保留為 status-only primitive，只服務 `decline/cancel/start-quoting/mark-quoted`，不承載 binding 或多表建立副作用。

理由：triage/convert 是帶跨表副作用與快照複製的複合操作，塞進 status primitive 會讓單一 RPC 承擔過多分支、模糊 status-only 契約，並讓錯誤碼與 pgTAP 覆蓋難以維持 100% reachable branch。專用 RPC 讓每條路徑的不變式（binding scope、convert-once、snapshot immutability）各自集中，符合 `docs/database-spec.md` 優先於 API 的順序。

### 2. openapi 合約對齊

- `TriageServiceRequestRequest` 補 `customerId`（required，符合 DB `TRIAGE_REQUIRES_CUSTOMER`）、`locationId/assetId/assignedMemberId`（optional，須同 customer scope）、`priority/category` 改為 optional 覆寫。
- `ConvertServiceRequestRequest` 統一為 `{ mode: "singleVisit" | "project", projectTitle?, workOrder?: { title, scheduledStartAt?, scheduledEndAt? } }`；`workOrder` 為兩種 mode 共用的唯一輸入，取代 `createInitialWorkOrder/workOrderTitle`。Assignment 要等 conversion transaction 真正寫入後才加入；目前 strict schema 直接拒絕，不接受後靜默忽略。
- HTTP 轉換回應遵循標準 `{ data: { serviceRequest, project|null, workOrder|null, replayed } }`；DB RPC 內部仍回 conversion result JSON。`project` 於 `singleVisit` 為 null，`workOrder` 於未建首張工單時為 null，`replayed` 明示是否為冪等重播。
- service request DTO 以 `subject` 為 canonical；openapi `title` 標為 `deprecated` 別名保留以維持向後相容，並在 create/update DTO 兩處同步。
- 新增 `category` 欄位到 `service_requests`（DB 側於 M3 migration 補上），供 API DTO；database-spec §4.1 一併補列。

### 3. triage relink 語意：直接 set，不刪 provisional customer/location

triage 綁定既有 customer 時，直接 `set customer_id/location_id/asset_id`，**不刪除**先前由 intake 自動建立的 provisional customer/location。

理由：

- provisional row 是 source evidence，保留可稽核「客戶最初以什麼身分進件」。
- 這些 row 可能被 `on delete restrict` 的 composite FK（其他 request、event、photo）參照，貿然刪除會觸發 FK 錯誤或需要串聯刪除稽核紀錄，違反 append-only 原則。
- relink 是冪等且安全的操作；重新 triage（`triaged → triaged`）允許補綁 location/asset。

### 4. orphan-cleanup 延後

被 relink 後失去引用的 provisional customer/location 之清理（orphan cleanup）**延後**，不在 M3 範圍：

- 需要一套獨立的、可稽核的軟刪除／合併流程（含 owner 確認與 event 記錄），與 hint-only 的「相似客戶」查詢配套，避免誤刪真實資料。
- M3 的 `find_similar_customers` 僅提供 hint，明確**不自動合併**；合併與清理是後續里程碑的獨立決策。

## 結果

- triage/convert 各有專用、pgTAP 釘住的 transaction RPC；`transition_service_request` 契約維持 status-only。
- openapi、api-spec、database-spec 三者對 triage binding、convert envelope、subject canonical 與 category 欄位一致，消除既有漂移。
- provisional customer/location 在 relink 後保留；orphan cleanup 與客戶合併留待後續里程碑，屆時需另立 ADR 定義安全的合併／軟刪除流程與稽核。
