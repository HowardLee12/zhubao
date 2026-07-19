# Renoly v2 驗收條件

> 本文件是產品、工程、QA 與試點共同簽收依據。API、資料欄位與狀態以 `docs/api-spec.md`、`docs/database-spec.md` 為準；若文件衝突，先修正文檔與 contract test，不以畫面現況默認新規格。

## 1. 驗收範圍

第一個可執行產品切片：

`進件 → 報價 → 客戶接受 → 工單／派工 → 前後照片與檢查 → 完工`

首批角色：

- **owner**：組織、成員、完整商業資料與最終送出權限。
- **dispatcher**：處理進件、報價與工單指派；owner-only 設定除外。
- **technician**：只處理自己有效指派的任務與必要現場資料。
- **customer（公開連結）**：只查看並回應 token 指定的客戶版報價或追加單。

工程追加簽認是保留模板：Phase 1 需可在 feature flag 下演示完整資料結構；Phase 2 才要求真實試點正式使用。

工作台顯示的案件階段（如待報價、待客戶確認、待排程、進行中）必須由 `service_request`、`quote`、`work_order`、`assignment` 等 canonical 狀態一致推導。畫面標籤可使用較口語的繁體中文，但不得另外寫入一套無法與 API 對應的狀態。

## 2. 全域驗收條件

### AC-G01 多租戶隔離

**Given** Alpha 與 Beta 是不同 organizations  
**When** Alpha 任何角色讀取、更新、刪除或建立關聯到 Beta 的資源  
**Then** API 回傳不洩漏資源存在性的 `403/404`，RLS 阻擋資料操作，資料庫內容不變，且安全 log 留下已遮罩事件。

驗收證據：SQL/RLS negative test、API integration、technician 直接 URL E2E。

### AC-G02 Server-side 授權

- UI 隱藏按鈕不視為授權；直接呼叫 API 仍須被角色與 RLS 阻擋。
- request path 不得使用 service role 代替使用者身分。
- membership 被停用後，即使舊頁面或舊 JWT 尚在，也不能進行下一次授權操作。

### AC-G03 輸入與錯誤

- 所有 mutation 由 server schema 驗證；未知欄位不被靜默寫入。
- 表單在欄位旁顯示可理解的繁體中文錯誤，保留不敏感的已輸入內容。
- API 使用一致 error envelope、request ID 與可區分的錯誤碼；production 不回傳 stack、SQL 或 secret。
- 依賴失敗不得顯示成功；可重試操作需提供明確重試入口。

### AC-G04 時間、金額與資料完整性

- DB 儲存 UTC，UI 以 `Asia/Taipei` 顯示並含明確日期；跨日／夏令時間 fixture 不造成錯排。
- 金額不使用 binary floating point；小計、折扣、稅與總額規則在前後端一致。
- 重要 mutation 使用 transaction；若任一步失敗，不留下半張報價、半次完工或孤立關聯。
- 狀態變更皆符合狀態機並產生 append-only event，包含 actor、時間、from／to 與 resource。

### AC-G05 冪等與並行

- 使用者雙擊、網路 retry 或 webhook 重送不產生重複商業資料。
- 相同 idempotency key + 相同 payload 回傳同一結果；相同 key + 不同 payload 回 `409`。
- 舊版本更新不得覆蓋較新的編輯；UI 顯示資料已變更並要求重新載入／合併。

### AC-G06 手機與可及性

- 390 × 844 viewport 可完成 owner、dispatcher、technician 主流程，無水平捲動。
- 主要操作觸控區原則上至少 44 × 44px。
- 表單有 label、錯誤關聯、可見 focus；鍵盤可完成核心流程。
- loading、empty、success、permission denied 與 failure 都有明確狀態，不只靠顏色傳達。
- 色彩與互動達 WCAG 2.1 AA 基本要求。

## 3. Concierge 主流程驗收

### AC-C01 登入與工作台

**Given** owner／dispatcher 是有效會員  
**When** 登入並開啟工作台  
**Then** 看見自己組織的待處理進件、待報價與今日工單，數字與列表相符，不出現其他組織資料。

- 未登入使用者進入內部 route 會被導向登入或顯示登入入口。
- technician 進入後只看到自己的任務入口，不看管理 KPI、內部成本或組織設定。
- empty state 必須能直接開始建立第一筆進件。

### AC-C02 建立客戶進件

**Given** owner／dispatcher 在進件頁  
**When** 輸入客戶姓名或稱呼、至少一種聯絡方式、服務地址、需求描述與可約時段並送出  
**Then** 建立一筆 `new` service request，關聯正確 customer／location，並在待處理清單可見。

- 缺少最低必填資料時不建立資料，欄位顯示錯誤。
- 同一客戶／地址可被搜尋並重用，不能因每次進件無條件產生重複 customer。
- 連點送出或 timeout retry 只建立一筆進件。
- owner 可補充內部備註；公開客戶頁與 technician 不得看見非必要內部備註。
- 進件的合法狀態為 `new → triaged → quoting → quoted → converted`，另可進 `declined/cancelled`；非法跳轉被 API 與 DB 拒絕。

### AC-C03 建立報價草稿

**Given** service request 可進入報價階段  
**When** owner／dispatcher 從 service catalog 或自訂方式加入項目、數量、單位與單價  
**Then** 系統即時計算每項小計與總額，儲存為 draft，重新整理後內容一致。

- 數量與價格的允許範圍由 API schema 驗證；空白、負數、超界、非法 decimal 被拒。
- 至少一個有效項目才可送出；內部成本／markup 與客戶顯示金額分離。
- UI 計算僅供即時回饋，server 重新計算並以 server 結果為準。
- 同時編輯衝突時，後提交的舊版本收到 `409` 而非覆蓋。

### AC-C04 送出與修訂報價

**Given** 報價草稿通過驗證  
**When** 有權角色確認送出  
**Then** 建立不可變的 sent quote version、產生限資源公開 token、紀錄送出 event，service request 轉為 `quoted`。

- 送出前有最終預覽與明確確認；第一版 AI 草稿不得未經 owner／dispatcher 確認自動送出。
- sent version 的 items、金額與客戶內容不可 update／delete。
- 修改 sent 報價須建立新 version；舊公開連結的有效／失效策略符合 API 規格並可稽核。
- 公開頁永不回傳 unit cost、markup、內部備註、其他版本機密欄位。

### AC-C05 客戶接受／拒絕報價

**Given** 客戶持有未過期、未撤銷且對應正確報價版本的 token  
**When** 客戶開啟公開頁並接受或拒絕  
**Then** 系統記錄指定版本、結果、時間、有限的 actor／request 證據與 event，owner 工作台可見最新狀態。

- token 無效、過期、撤銷或資源不符時不顯示報價內容，也不透露資源是否存在。
- 接受操作有確認步驟；重複提交不建立第二筆 acceptance。
- 接受後 quote 為 `accepted`，service request 可轉為 `converted`；拒絕則依規格為 `rejected/declined`。
- 客戶接受僅代表該版本的產品簽認紀錄；UI 不可宣稱未經法律審查的法律效力。

### AC-C06 建立工單與派工

**Given** 報價已接受或 owner 依權限核准例外流程  
**When** dispatcher 建立 work order、設定服務日期／時段並指派 technician A  
**Then** 工單為 `scheduled`，assignment 為 `assigned`，技師 A 任務清單可見，技師 B 不可見。

- 日期、時段、服務地點與至少一位有效 technician 通過驗證後才能派工。
- 被停用、不同 organization 或不具 technician 角色的 member 不可被指派。
- 時段衝突至少顯示清楚警告；是否硬性阻擋以產品規格為準且必須有測試。
- 重新指派保留歷史 event；舊 technician 在 assignment 失效後不能再取得工單。
- 連點派工不產生重複 active assignment 或重複通知。

### AC-C07 技師任務與狀態

**Given** technician A 有有效 assignment  
**When** 開啟任務  
**Then** 只看執行所需的客戶聯絡、地址、服務內容、時段、checklist 與照片，不看成本、markup、其他工單或管理設定。

- assignment／work order 狀態依 API 規格合法轉移；跳過必要階段或倒退被拒。
- 出發、到場、暫停與恢復顯示目前狀態與時間，成功後寫入 event。
- 網路失敗時畫面回復至 server 真實狀態並可重試；optimistic UI 不可永久誤顯成功。
- 技師 B 直接開 URL、呼叫 API、猜 UUID 或修改 request payload 都無法讀寫任務。

### AC-C08 施工照片

**Given** technician A 在可執行的工單  
**When** 上傳施工前、施工後或異常照片  
**Then** server 驗證實際檔案格式、大小與數量，物件存入 private storage，DB 建立含分類與 uploader 的紀錄，授權使用者可查看短效 URL。

- 接受的 MIME、副檔名、大小、張數與壓縮規則以 API 規格為準，UI 在上傳前提示。
- 偽裝 MIME、損壞內容、超限與未授權上傳被拒，且不留下 DB row 或 orphan object。
- Storage 成功但 DB 失敗、DB 成功但後續失敗均有補償／reconciliation 策略與測試。
- 同檔／同 idempotency key 重送不產生重複照片。
- signed URL 過期後失效；不同 organization／未指派 technician 無法產生 URL。
- 刪除採權限與稽核規則，不允許 technician 任意刪除已用於完工證據的照片。

### AC-C09 Checklist 與完工

**Given** 工單已到場  
**When** technician 嘗試完工  
**Then** 系統在同一 transaction 驗證必要 checklist、至少一張施工前照、至少一張施工後照及合法狀態。

- 任一條件不足時回傳具體阻擋項目，work order 保持未完成，不能產生 completed event。
- 條件齊全時 work order 轉 `completed`、assignment 轉 `completed`，寫入唯一 completed event 與完成時間。
- 完工 request 重送仍只有一次狀態副作用與一筆對應事件。
- 完工後照片與 checklist 的修正受限並留下 audit；不得悄悄改寫原證據。
- owner／dispatcher 工作台在可接受延遲內反映完工，能查看時間線與前後照片。

### AC-C10 完整旅程

Playwright 必須以 UI 與實際 API／local DB 完成 AC-C01 至 AC-C09；不能在測試中直接改 DB 跳過報價接受、指派或完工必要條件。測試結束後，必須能從事件時間線重建：誰在何時建立進件、送出哪個報價版本、誰接受、指派給誰、何時出發／到場、上傳哪些證據、何時完工。

## 4. 工程追加簽認模板驗收

### AC-O01 建立追加單

**Given** owner／dispatcher 可管理一個 active project  
**When** 建立 change order 並加入追加／追減項目、原因、金額與關聯照片  
**Then** 儲存為 `draft`，總額正確，且與原始 quote／project 分開追蹤。

- 追減的表示與總額算法有單一規則；不可用模糊字串代表負數。
- 不同 organization 的 project、photo、customer 不能被關聯。
- technician 可提報現場異常或草稿素材，但是否可建立正式 change order 依角色規格限制。

### AC-O02 送出與不可變版本

**Given** change order draft 通過驗證  
**When** 有權角色確認送出  
**Then** 狀態為 `sent`、內容與金額不可原地修改，產生客戶版 token 與送出 event。

- 修訂須建立新版本或新的 change order；舊紀錄仍可稽核。
- 客戶公開頁只顯示被送出的版本、追加原因、客戶可見照片與淨額。

### AC-O03 客戶簽認

**Given** token 有效且 change order 尚可回應  
**When** 客戶接受或拒絕  
**Then** 只發生一次狀態轉移至 `accepted` 或 `rejected`，紀錄版本、actor 證據與時間。

- 過期／撤銷 token、舊版本或重送不能覆寫已完成決定。
- 接受後 owner 可由 project timeline 查看證據，後續 payment milestone 是否建立依產品規格明示。
- UI 用「簽認紀錄」而非未經法律審查的「具法律效力電子簽章」宣稱。

## 5. API 契約驗收

每個 endpoint 至少通過以下矩陣：

| 類別 | 必須驗證 |
|---|---|
| 成功 | status、response schema、DB 狀態、event／outbox 副作用 |
| Validation | 缺欄、未知欄位、型別、長度、邊界、非法狀態 |
| Authentication | 無 session、過期 session、撤銷／過期 public token |
| Authorization | 角色不足、跨租戶、未指派 technician、owner-only 操作 |
| Concurrency | stale version、同時更新、狀態已改變 |
| Idempotency | 相同 key 同 payload、相同 key 不同 payload、timeout retry |
| Dependency | DB、Storage、LINE／notification timeout、4xx、5xx、malformed response |
| Privacy | response 與 error 不含成本、secret、SQL、其他租戶或不必要個資 |

列表 API 另驗收 cursor／pagination、穩定排序、limit 上限與空結果。Public endpoint 需 rate limit 並避免資源枚舉。Mutation 成功但通知待送時，response 應區分商業操作成功與通知狀態。

## 6. 安全、隱私與稽核驗收

- 全部營運表啟用 RLS，policy 有 SQL 正向與負向案例。
- Storage bucket 為 private；照片 path 含 organization scope，但授權不只依賴 path 字串。
- LINE channel secret、access token 與其他 credential 加密保存、遮罩顯示、可輪替；不進 client bundle／log。
- public token 以不可逆 hash 或等價安全方式保存，具 expires／revoked／scope／resource 綁定。
- audit event append-only；一般 app 角色不能 update／delete。
- 敏感 export、成員／channel 設定與資料刪除為 owner-only，並留下 event。
- Production error、analytics、Playwright artifact 不包含完整 token、客戶照片或不必要 PII。
- Rate limit 至少覆蓋登入、公開 token、客戶回應、上傳與 webhook。

任何跨租戶讀寫、成本外洩、公開 bucket、可偽造 webhook 或 service role 進入 client/request path 都是 release veto。

## 7. 效能與可靠性驗收

在 agreed staging dataset 下：

- 一般讀取／寫入 API p95 小於 500ms；建立報價與完工 transaction p95 小於 1s，不含外部通知。
- dashboard 與 task list 不因 N+1 查詢隨 100 筆資料線性發出大量 request。
- 照片上傳顯示進度，弱網中斷可安全重試；上傳失敗率與 orphan object 可監控。
- Outbox 重試有 backoff、最大次數、失敗狀態與人工重送；provider 故障不 rollback 已成立的報價接受或完工。
- Webhook 驗簽、去重、out-of-order 與快速 2xx 行為在 Phase 2 測試通過。
- Backup restore、前一版應用 rollback、feature kill switch 與高風險 migration rehearsal 在 production 前完成。

## 8. Phase exit 驗收

### Phase 0

- 文件、resource、狀態、錯誤與角色權限完成 review。
- 空 DB migrations + seed + RLS tests 可重現。
- Vitest／Testing Library、API integration、SQL、Playwright 與 coverage 指令進入 CI。
- Alpha／Beta 跨租戶負向案例與最小 auth smoke 全綠。

### Phase 1

- AC-G01–G06、AC-C01–C10 全部自動或人工驗收通過。
- AC-O01–O03 可在 feature flag 與 demo seed 下演示，且 contract／security tests 通過。
- 四項 coverage 80% 以上，關鍵安全／金額／狀態規則 100% 可達分支。
- Chromium mobile concierge、tenant isolation 與 change-order E2E 全綠。
- 無 P0／P1 defect；P2 有 owner、workaround 與期限才可有條件接受。

### Phase 2

- 3–5 個 pilot organizations 隔離運行，無跨租戶或不可恢復事故。
- 真實符合條件案件至少 70% 完成系統主流程紀錄。
- 完整工單定義：進件來源、有效報價／核准例外、assignment、必要前後照、checklist、completed event 均存在。
- LINE webhook／outbox／kill switch、backup restore 與 rollback 演練通過。
- 每店導入與支援時間有記錄，可區分產品自動化與 founder concierge。
- UAT、security review、operations runbook 與 production checklist 簽收。

## 9. UAT 劇本與證據

每個試點至少執行一次：

1. 用自己的 service catalog 建立兩項報價。
2. 從真實但經同意的詢問建立進件；若在 staging，使用去識別資料。
3. 將工作指派給另一支手機登入的 technician。
4. 在現場或模擬現場完成狀態、前後照、checklist 與完工。
5. owner 從 timeline 說明整張案件發生順序。
6. 模擬弱網、重複送出與未授權 URL，確認不重複、不外洩。
7. 工程型試點另建立並簽認一張 change order。

UAT evidence 包含：版本／commit、環境、角色、日期、結果、失敗 screenshot／request ID、人工協助分鐘數、已知限制與簽收者。不得把含客戶 PII 的 screenshot 放入公開 issue。

## 10. Traceability matrix

| 使用者結果 | 主要 resource | 主要 UI | 最低自動測試 |
|---|---|---|---|
| 詢問不漏單 | customers、locations、service_requests | 待處理清單／進件表單 | unit + component + API + RLS + E2E |
| 報價正確且可追版本 | quotes、quote_versions、quote_items | 報價 builder／公開頁 | amount unit + API + immutability SQL + E2E |
| 正確的人收到正確工作 | work_orders、assignments | 派工板／技師任務 | state unit + API + RLS + tenant E2E |
| 現場證據可追溯 | photos、checklists、events | 上傳／checklist／timeline | component + Storage integration + RLS + E2E |
| 完工不缺必要條件 | work_orders、assignments、events | 完工確認 | domain + transaction integration + E2E |
| 追加工程有明確簽認 | projects、change_orders、events | 追加單／公開簽認 | amount unit + API + token/RLS + E2E |

## 11. Release veto 與最終簽收

下列任一項存在即不得發布：

- 跨租戶讀寫、technician 越權、客戶頁成本或內部資料外洩。
- sent quote／change order 或 audit event 可被原地修改。
- 完工 transaction 可能留下部分成功，或雙擊造成重複副作用。
- private photo 可被未授權取得，或 credential 進入 client／repository。
- required CI、RLS negative、concierge E2E 或 coverage gate 未通過。
- 無可執行 rollback／kill switch，或 migration 無法由空 DB 重現。
- P0／P1 defect 未解決。

最終簽收需由 product、engineering、QA/security 與 pilot owner（Phase 2）共同確認；「畫面可以點」不等於完成，必須同時具備資料正確、權限安全、失敗可恢復與可追蹤測試證據。
