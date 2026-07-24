# Renoly v2 實作與交付計畫

> 目標：從已刪除的資料庫重新建立安全、可測試的 v2，先交付可操作的 concierge demo，再以真實試點決定後續產業模板。此文件不要求相容舊資料表。

## 1. 交付策略

Renoly v2 的產品核心是「小型工程與到府服務團隊，從 LINE／電話詢問到報價、派工、現場證據與完工的工作台」。技術核心保持產業通用，第一個切片以冷氣、水電、抓漏／防水常見流程驗證。

第一個可執行 vertical slice：

```text
owner／dispatcher 手動建立進件
  → 建立並確認報價
  → 客戶接受
  → 建立工單與指派技師
  → 技師出發／到場／上傳施工前後照
  → 完成檢查與工單
  → owner 查看事件時間線
```

同時保留工程模式：`project → change_order → 客戶簽認 → 稽核紀錄`。Phase 1 可先提供可展示模板；Phase 2 才列為正式試點流程。

## 2. 已知前提與決策

- 舊 Supabase 資料庫已刪除，v2 不做舊 schema migration 或資料相容層。
- 現有 Next.js 16、React 19、TypeScript、Tailwind、部分報價／照片／排程 UI 可作視覺與互動參考，但 server action、query 與資料型別需依 v2 契約重接。
- 多租戶與 RLS 從第一個 migration 建立，不接受先開放、日後再補的 policy。
- 所有營運資料以 `organization_id` 隔離；`owner`、`dispatcher`、`technician` 是首批內部角色。
- v2 核心 resource 與狀態以 `docs/api-spec.md`、`docs/database-spec.md` 為單一真相來源。
- `docs/product-spec.md` 所定義的使用者可見「案件階段」由 canonical resource 狀態推導，不在資料庫維護第二套互相競爭的狀態機。
- 客戶不必安裝 App；公開報價與簽認使用短效、可撤銷、限資源 token。
- AI、完整 POS／庫存、電子發票、路線最佳化、全自動 LINE bot 不在首個切片。
- 所有功能採 TDD，測試要求見 `docs/testing-strategy.md`。

## 3. Phase 0 — 合約、基礎與可持續開發

### 3.1 目標

建立所有後續 agent 可平行開發而不互相猜測的契約，以及從空資料庫可重現的安全基線。

### 3.2 交付物

1. **文件契約**
   - 產品範圍、角色、頁面與主流程。
   - architecture、API、database、security、testing、acceptance 文件。
   - resource 命名、狀態機、錯誤格式、金額與時間規則定版。
2. **測試骨架**
   - Vitest、React Testing Library、coverage、Playwright。
   - local Supabase 與 SQL/RLS test runner。
   - 固定 seed、角色 session factory、外部服務 fake adapter。
   - package scripts 與 required CI jobs。
3. **資料與安全基線**
   - 從空 DB 可套用的 versioned migrations。
   - organizations、memberships、customers、locations、service_requests、projects、work_orders、assignments、service_catalogs、quotes、quote_versions、quote_items、change_orders、checklists、photos、events 等第一批表。
   - constraint、index、trigger、RLS、private Storage policy 與 append-only audit event。
4. **應用骨架**
   - session、organization context、角色 guard、統一錯誤邊界。
   - domain／repository／adapter 邊界；request ID 與結構化 log。
   - feature flags：`concierge_flow`、`change_order_template`、`line_automation`。
5. **環境**
   - local、preview、staging、production 的環境變數契約。
   - secret 不進 Git；preview 使用 sandbox provider。

### 3.3 執行順序

1. 凍結文件中的 resource、狀態與錯誤契約。
2. 先寫 constraint、RLS 負向與狀態轉移 SQL 測試。
3. 建 migration、RLS 與 seed 讓測試轉綠。
4. 建 API integration harness 與一般使用者 JWT factory。
5. 建應用 session／organization skeleton 與第一個 health／auth smoke。
6. 接上 CI，確認乾淨 checkout 可完成 DB reset、測試與 build。

### 3.4 Phase 0 exit gate

- 從空 DB 一次套用所有 migration 與 seed 成功。
- Alpha／Beta 兩個租戶的 RLS 正向、跨租戶負向測試通過。
- lint、typecheck、unit、SQL、API integration、Playwright smoke、build 均有可執行指令。
- coverage 門檻由 CI 強制，沒有 secrets 或 production endpoint。
- 文件 review 完成；未決策項有 owner、期限與預設行為。

## 4. Phase 1 — Concierge demo vertical slice

### 4.1 目標

在不依賴每家店 LINE OA 自動化的前提下，讓業者以真實手機完成一張案件從進件到完工。可由 founder 協助導入，但所有人工步驟需記錄。

### 4.2 Must-have 範圍

#### Owner／dispatcher 工作台

- 今日摘要：待處理進件、待報價、今日工單、等待完工。
- 手動建立／編輯 service request，關聯 customer 與 location。
- 由進件建立 quote draft，使用 service catalog 或自訂項目。
- 金額計算、預覽、送出、接受後建立 project／work order。
- 日／週派工視圖，建立 appointment 資訊並指派 technician。
- 查看照片、checklist、狀態與 append-only event timeline。

#### Technician 手機介面

- 只顯示自己的今日／未完成 assignments。
- 查看必要客戶與地址資訊，執行 `accepted → checked_in → completed`；work order 依規格轉移為 `en_route → on_site → completed`。
- 上傳施工前、施工後與異常照片；離線／弱網錯誤可重試且不誤顯成功。
- 完成必要 checklist；缺少必要條件時不能完工。

#### 客戶公開頁

- 以可撤銷、限範圍 token 查看客戶版報價。
- 接受或拒絕報價；重複提交具冪等性。
- 不顯示成本、markup、內部備註、membership 或其他客戶資訊。

#### 工程追加模板

- demo seed 包含一個 project 與 change order。
- owner 可建立 draft、預覽客戶版；feature flag 下可演示送出／接受。
- 送出版本不可原地修改，稽核資料結構與正式 API 契約一致。

### 4.3 明確不做

- 每店 LINE channel 自助連接、完整 webhook 與所有自動通知。
- AI 自動診斷、定價、接受報價或代替老闆回覆。
- 原生 iOS／Android、完整離線模式、庫存、採購、會計、電子發票。
- 複雜路線最佳化、多人即時協同編輯與大型工程 ERP。
- 以大量 dashboard 或報表延後核心交易流程。

### 4.4 Phase 1 執行 slices

每個 slice 都以「測試紅 → 最小實作 → 綠 → 重構」完成：

| Slice | 後端／資料 | 前端 | 跨層驗證 |
|---|---|---|---|
| 1. 組織與角色 | session、membership、RLS | organization guard、角色導覽 | 未登入／錯租戶／技師直接 URL |
| 2. 進件 | customer、location、service_request API | 待處理清單、建立／編輯表單 | 建立後立即可追蹤，重送不重複 |
| 3. 報價 | catalog、quote、version、item、狀態機 | builder、預覽、公開頁 | 金額、送出唯讀、客戶接受 |
| 4. 工單與派工 | work_order、assignment、轉移規則 | 排程與 technician task list | 未指派不可見、非法轉移被拒 |
| 5. 照片與完工 | private storage、photo、checklist、event | 上傳、分類、完工阻擋 | 前後照與 checklist 齊全才完成 |
| 6. 垂直整合 | transaction、idempotency、audit | 狀態連續體驗與錯誤恢復 | concierge Playwright 全流程 |
| 7. 追加模板 | project、change_order、public token | draft／preview／signoff template | version immutability 與 audit |

### 4.5 Phase 1 exit gate

- 兩個 seed 租戶與三種內部角色完成 concierge E2E；跨租戶 E2E 通過。
- owner、dispatcher、technician 可在 390px viewport 完成各自流程。
- 報價送出版本、已簽認追加單與 event 不可修改。
- 前後照、checklist 與完工 transaction 有失敗回復測試。
- global coverage 四項 80% 以上；安全／金額／狀態邏輯 100% 可達分支。
- staging 可重設 demo data；demo 不使用 production token 或真實客戶資料。
- 內部團隊以文件從空環境重現成功，重大與高風險 defect 為 0。

## 5. Phase 2 — 真實試點與營運硬化

### 5.1 目標

讓 3–5 家 design partner 使用真實案件，補上可靠通知、導入與營運工具；用數據判斷哪個產業模板值得擴張。

### 5.2 交付物

- 每店 LINE OA channel 的安全連接、webhook 驗簽、event 去重、outbox 與重試。
- 客戶 LINE／公開表單進件；owner 確認後才發報價，AI 若加入只產生 draft。
- 通知：受理、預約、出發、完工與付款提醒，均有狀態、失敗與人工重送。
- change order 正式啟用：送出、客戶簽認、版本與證據紀錄。
- payment milestone 最小收款追蹤；不做總帳或完整 POS。
- maintenance plan／設備履歷模板，支援 6／12 個月回訪但不自動承諾維修判斷。
- audit／support console、匯出與必要資料刪除流程。
- 基本 KPI：首次回覆時間、報價接受率、完工率、回訪率；指標定義固定。
- onboarding checklist、產業模板、service catalog 匯入與操作手冊。
- 監控、alert、備份驗證、rate limit、依賴故障 runbook。

### 5.3 試點量測

每家店記錄：

- 導入分鐘數、初始資料整理分鐘數、每週支援分鐘數。
- 符合條件案件中真正進入系統的比例。
- 進件至首次回覆、報價送出、接受、派工、完工的轉換與耗時。
- 工單是否具備完整前後照與事件時間線。
- 使用者回到 LINE／紙本／試算表的原因。
- 工程模式：真實追加簽認與進入請款的次數。
- 到府服務模式：設備／回訪帶回預約的次數。

商業是否繼續的付費與留存門檻，由產品決策文件另行定義；技術不得用註冊數或 demo 完成數取代活躍與付費證據。

### 5.4 Phase 2 exit gate

- 至少 3 家隔離租戶跑真實流程，無 P0／P1 資料外洩或不可恢復事故。
- 第六個等價導入流程低於 90 分鐘；第一週後每店每週人工支援低於 30 分鐘（或留下明確偏差與決策）。
- 真實案件 70% 以上在系統留下完整主流程狀態；完整率定義見驗收文件。
- LINE webhook duplicate／out-of-order／timeout、通知失敗重試與 kill switch 演練通過。
- backup restore、單 migration rollback／forward-fix、前一版應用 rollback 演練通過。
- production checklist、資料處理告知、客服與 incident runbook 完成。

## 6. Agent 分工與邊界

多 agent 平行開發以「檔案所有權 + 契約先行」避免互相覆寫。每一批次由 integration owner 指定唯一 owner；共用檔案不可同時修改。

| Agent／工作流 | 主要責任 | 建議檔案邊界 | 不負責 |
|---|---|---|---|
| Product／UX | user story、頁面狀態、文案、驗收條件 | `docs/product*.md`、wireframe／story | DB policy、API 實作 |
| Database／Security | migration、constraint、RLS、Storage policy、SQL tests | `supabase/**` | UI、route handler |
| API／Domain | validation、狀態機、repository、route、integration tests | `src/domain/**`、`src/app/api/**`、`tests/integration/**` | page layout、migration policy |
| Owner／Dispatcher UI | dashboard、進件、報價、派工 | 指定 route 與 `src/components/owner/**` | technician 頁面、DB schema |
| Technician UI | 任務、狀態、照片、checklist | 指定 route 與 `src/components/technician/**` | 報價金額、membership |
| QA／Delivery | test harness、E2E、CI、release evidence | `e2e/**`、test config、CI workflow、測試文件 | 為了測試方便放寬產品權限 |
| Integration owner | 契約凍結、shared files、merge 順序、release／rollback | `package.json`、shared config、最終 docs index | 平行大改各 agent 所有檔 |

協作規則：

1. API／DB 變更先更新 spec 與 contract test，再通知所有 consumer。
2. 每個 agent 在獨立 branch／worktree 工作；開始前記錄允許修改的 path。
3. `package.json`、lockfile、generated DB types、global CSS、root layout、CI workflow 由 integration owner 串行整合。
4. generated types 只由固定命令重建，不手工合併。
5. Agent 不得自行放寬 RLS、跳過測試、把 service role 移到 request path，或改掉 acceptance 來使實作過關。
6. 每個 slice 先合 DB／domain contract，再 API，最後 UI 與 E2E；可用 fake adapter 平行，但合併前要換成真實 contract。
7. 交接訊息必須包含：修改檔案、測試指令與結果、未決風險、migration／env 影響、rollback 方法。

## 7. 共用 Definition of Done

任何 Phase／slice 標記完成前必須同時符合：

- 行為符合 `docs/acceptance-criteria.md`，API／DB／security 文件同步。
- 依 TDD 開發；單元、元件、API integration、SQL/RLS、必要 E2E 通過。
- 四項 coverage 80% 以上，關鍵規則 100%；無 `skip`、`only` 或未追蹤 quarantine。
- 輸入在 server 驗證；授權在 server／RLS 執行，不能只依賴 UI 隱藏。
- mutation 有 transaction／冪等／concurrency 策略；狀態轉移留下 audit event。
- loading、empty、success、validation、permission、dependency failure 與 retry 狀態均實作。
- 390px mobile、鍵盤操作、WCAG AA 基本檢查通過。
- log 不含 secret、完整 token、成本外洩或不必要個資；request ID 可追查。
- migration 從空 DB 可重現；seed 無真實資料；必要 index 與 query plan 已檢查。
- preview／staging 驗收完成；文件列出 deployment、feature flag、rollback 與已知限制。
- reviewer 能以文件中的命令重現，且沒有 P0／P1 defect。

## 8. 發布、migration 與 rollback

### 8.1 發布順序

1. 備份並記錄 schema／app 版本。
2. 套用 backward-compatible migration。
3. 驗證 migration、RLS、health 與 smoke test。
4. 部署可同時相容前後 schema 的應用。
5. 以 organization allowlist 開 feature flag。
6. 觀察錯誤率、延遲、DB connection、storage 與 outbox。
7. 穩定後逐步擴大；破壞性 cleanup 置於後續獨立 migration。

### 8.2 Rollback 原則

- **應用錯誤**：關閉 feature flag，回復上一個已知良好 deployment；DB 保持 backward-compatible。
- **外部整合錯誤**：啟用 LINE／notification kill switch，保留 outbox 不遺失，修復後受控重送。
- **migration 錯誤**：優先 forward-fix；只有經 staging 演練且不會丟資料時才執行 down migration。
- **RLS 錯誤**：立即關閉受影響功能或回復上一個安全 policy；不得以 `USING (true)` 作緊急方案。
- **照片／Storage 錯誤**：停止新上傳，保留 DB 狀態與 object 清單，以 reconciliation job 修復，不批次盲刪。
- **資料污染**：停用寫入、保存 audit／log、以 organization 範圍辨識影響，從備份或補償 transaction 復原。

每次 production 變更在 PR／release note 記錄 rollback owner、判斷閾值、指令或 runbook 連結。高風險 migration 必須先完成 staging restore rehearsal。

## 9. 主要風險與處理

| 風險 | 早期訊號 | 降低方式 | 發生時處理 |
|---|---|---|---|
| 通用產品範圍膨脹 | 每個訪談都新增專屬欄位 | 核心 + template；Phase 1 鎖定 vertical slice | 延後非核心模組，以付費證據排序 |
| 多租戶外洩 | query 依賴 client filter／service role | RLS first、負向 SQL/API/E2E | kill switch、incident、受影響租戶盤點 |
| 狀態模型不一致 | UI、API、DB 各有一套字串 | spec + domain state machine + DB constraint | 凍結寫入，migration 正規化並補事件 |
| LINE 平台依賴 | webhook 重送、延遲、token 失效 | adapter、outbox、去重、人工 fallback | 停自動發送，保留待送佇列與人工通知 |
| 照片成本與失敗 | 上傳逾時、orphan objects 增加 | 壓縮、上限、private bucket、reconciliation | 暫停上傳、重試與孤兒清理 |
| Founder concierge 被誤認成產品效率 | 每店支援時間持續偏高 | 記錄每個人工步驟與分鐘數 | 把高頻人工步驟產品化或停止該模板 |
| 測試只 mock 不反映 DB | unit 綠但 staging 權限失敗 | local Supabase integration + SQL/RLS gate | 阻擋發布，補真實 DB regression |
| Agent 合併衝突 | 多人改 shared config／generated files | path ownership、integration owner、短 PR | 停止平行合併，依契約重新 rebase |
| 無法 rollback | migration 同時 rename／drop／backfill | expand-migrate-contract、feature flags | 回上一版 app 或 forward-fix，不盲目 down |
| 真實需求不足 | demo 好評但無持續真實工單 | Phase 2 量測案件完整率、留存與付費 | 停止擴功能，重新選模板或市場 |

## 10. 建議節奏

- Phase 0：1–2 週，完成文件、測試／DB／CI 基線。
- Phase 1：4–6 週，以 7 個 vertical slices 逐週交付 staging。
- Phase 2：4–8 週，3–5 家試點與平台硬化；依真實使用調整。

時程是容量假設，不是犧牲安全與測試的承諾。任何 RLS、金額、狀態或資料完整性 gate 未通過時，該 slice 不進入真實客戶環境。
