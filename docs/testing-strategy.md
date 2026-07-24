# Renoly v2 測試策略

> 狀態：v2 開發與合併的測試契約。API、資料表與狀態定義以 `docs/api-spec.md`、`docs/database-spec.md` 為準。

## 1. 目的與品質門檻

Renoly v2 採測試驅動開發（TDD）。第一個可執行切片是 concierge demo：

`進件 → 報價 → 派工 → 施工前後照片 → 完工`

同一套核心必須保留「工程追加簽認」模板，證明資料模型不只支援單次到府服務。測試的首要任務不是追求測試數量，而是確保下列風險在進入真實試點前被阻擋：

1. 店家 A 讀取或修改店家 B 的資料。
2. 技師取得未指派工單、成本、客戶或管理資訊。
3. 報價或追加單送出後仍被原地竄改。
4. 重送請求、webhook 或背景任務造成重複報價、照片、通知或狀態事件。
5. 網路或第三方服務失敗後，畫面顯示成功但資料未落盤。
6. 缺少必要照片或檢查結果時仍可將工單標記完成。

所有合併至主分支的程式碼必須符合：

- 單元與整合測試全數通過，無 `skip`、`only` 或刻意停用案例。
- statements、branches、functions、lines 四項全域覆蓋率均至少 80%。
- 權限、租戶隔離、金額計算、狀態轉移與冪等邏輯的可達分支為 100%。
- SQL/RLS 正向與負向測試全數通過；不得只用 service role 驗證功能。
- concierge 主流程與工程追加簽認流程的 Playwright 測試通過。
- lint、TypeScript、production build 與 migration reset 均通過。

80% 是最低合併門檻，不得以排除核心檔案、空測試或快照取代行為驗證的方式達成。

## 2. 測試技術組合

| 層級 | 工具 | 測試對象 | 執行環境 |
|---|---|---|---|
| 靜態檢查 | TypeScript、ESLint | 型別、未處理分支、危險用法 | Node.js |
| 單元測試 | Vitest | 金額、狀態機、權限決策、驗證 schema、格式化函式 | `node` |
| 元件測試 | Vitest、React Testing Library、`user-event`、`jest-dom` | 表單、按鈕狀態、錯誤回饋、可及性語意 | `jsdom` |
| API 整合 | Vitest、Next.js route handler、真實本機 Supabase | 驗證、授權、交易、冪等、錯誤契約 | Node.js + local Supabase |
| SQL/RLS | pgTAP 或等價 SQL assertion、Supabase CLI | migration、constraint、trigger、RLS、跨租戶阻擋 | local PostgreSQL |
| E2E | Playwright | owner／dispatcher／technician／客戶公開連結完整旅程 | Chromium；發布前加 WebKit |
| 外部整合契約 | Vitest、MSW 或可注入 fake adapter | LINE、通知、Storage 的輸入輸出與失敗重試 | Node.js |

原則：

- 純函式與 UI 可 mock 邊界；資料庫權限、交易與 constraint 必須打真實本機 PostgreSQL。
- API 整合測試須由一般使用者 JWT 或公開 token 進入，不以 service role 代替使用者情境。
- LINE、簡訊、Email 等外部服務在 CI 不呼叫正式端點，改用 adapter fake；另以少量 staging smoke test 驗證正式契約。
- 元件測試以角色、標籤與可見文字選取元素；只有無合適語意時才使用 `data-testid`。

前端顯示的「案件階段」（例如待客戶確認、待排程、待驗收）是多個 canonical resource 狀態的投影，不另存一套可任意修改的 enum。測試須驗證 `service_request`、`quote`、`work_order`、`assignment` 等狀態如何投影成畫面階段，避免 UI 與 API 各自演化。

## 3. TDD 開發循環

每一個 user story 依下列順序實作：

1. 寫出角色、行為、商業結果與 Given/When/Then 驗收條件。
2. 先加入最小失敗測試：domain unit → API integration／SQL → component → E2E。
3. 執行測試並保留合理的紅燈，確認是「功能尚未存在」而非測試本身壞掉。
4. 寫出讓測試通過的最小實作。
5. 維持綠燈後重構；不得先改測試來迎合錯誤實作。
6. 加入邊界、錯誤、重複請求、跨租戶與角色不足案例。
7. 執行完整品質門檻並更新對應文件。

Bug 修復必須先新增一個能重現問題的失敗測試。Production incident 則至少要補單元／整合測試；若影響使用者主流程，再補 E2E regression。

## 4. 建議測試目錄

```text
src/
├── domain/**/*.test.ts                  # 純商業規則與狀態機
├── components/**/*.test.tsx             # Testing Library 元件測試
└── app/api/**/route.test.ts              # route handler 契約測試
tests/
├── integration/
│   ├── helpers/                          # JWT、DB reset、request factory
│   ├── service-requests.test.ts
│   ├── quotes.test.ts
│   ├── work-orders.test.ts
│   ├── photos.test.ts
│   └── change-orders.test.ts
├── contract/                             # LINE／通知／Storage adapter 契約
└── fixtures/                             # 非敏感、可重複 fixture
supabase/
├── migrations/
├── seed.sql
└── tests/
    ├── constraints.test.sql
    ├── rls-memberships.test.sql
    ├── rls-work-orders.test.sql
    ├── rls-public-share.test.sql
    └── state-transitions.test.sql
e2e/
├── fixtures/                             # 角色 session 與 DB factory
├── concierge-flow.spec.ts
├── change-order-signoff.spec.ts
├── tenant-isolation.spec.ts
└── accessibility.spec.ts
```

測試不得彼此依賴執行順序。每個案例建立自己的資料，或在測試檔開始前還原至明確 seed；不得沿用上一個案例建立的 ID。

## 5. 測試資料與 seed

### 5.1 固定 personas

`supabase/seed.sql` 應提供不含真實個資的固定資料：

| 代號 | 租戶／角色 | 用途 |
|---|---|---|
| `org_alpha_owner` | Alpha 冷氣水電／owner | 完整管理權限 |
| `org_alpha_dispatcher` | Alpha／dispatcher | 進件、報價、派工 |
| `org_alpha_tech_a` | Alpha／technician | 已指派工單 |
| `org_alpha_tech_b` | Alpha／technician | 未指派工單負向案例 |
| `org_beta_owner` | Beta 防水工程／owner | 跨租戶隔離 |
| `public_customer` | 非會員客戶 | 報價與追加單公開簽認 |

固定情境至少包含：

- 一筆 `new` 的 `service_request`。
- 一份含兩個項目的 `draft` 報價。
- 一張已指派給 Alpha 技師 A 的 `scheduled` 工單。
- 一張已送出且不可變更的報價版本。
- 一個小型工程 `project` 與一份 `draft` `change_order`。
- 一筆過期公開 token、一筆已撤銷 token，以及同值但不同租戶的資源 ID 測試資料。

### 5.2 資料建立規則

- seed 使用固定 UUID、固定時區 `Asia/Taipei` 與固定基準時間，避免日期測試隨執行日漂移。
- 動態測試資料使用 factory，名稱加上 test run ID；結束後清除。
- 金額一律用整數最小幣別或明確 decimal，不用浮點數 fixture。
- 照片 fixture 使用小型有效 JPEG／WebP、偽裝 MIME、超大檔宣告與損壞內容四種。
- Storage 測試使用獨立 bucket 或 prefix，測試後刪除；資料庫 rollback 不會自動刪除 object。
- 不在 seed、fixture、snapshot 或 CI log 放 LINE token、channel secret、手機、地址或客戶照片。

### 5.3 Reset 策略

- 本機與 CI 在 integration／E2E 前執行 `supabase db reset`，套用所有 migration 與 seed。
- SQL 測試每個案例使用 transaction，結束 rollback。
- 平行 E2E 使用不同 organization namespace；若不能完全隔離，資料庫相關 spec 暫時單 worker 執行。
- staging smoke test 使用專用測試租戶，所有測試資料標記 TTL 並由排程清除。

## 6. 測試矩陣

| 能力 | 單元／元件 | API 整合 | SQL／RLS 負向 | Playwright |
|---|---|---|---|---|
| 登入與組織切換 | session、角色顯示 | 無 session／過期 session／非會員 | 未登入、錯租戶、停用會員被拒 | owner 可進入；未登入導回登入 |
| 進件 | 必填、電話／地址、草稿保留 | 建立、查詢、重送、非法欄位 | B 租戶不可讀寫 A 進件 | 建立後出現在待處理清單 |
| 報價 | 小計、總計、折扣、空項目、唯讀狀態 | 草稿 CRUD、送出、接受、修訂 | 送出版本不可改；技師不可見成本 | owner 建立並送出；客戶接受 |
| 派工 | 日期、技師選擇、衝突提示 | 建立工單、指派、狀態轉移 | 未指派技師不可讀；跨租戶 FK 被拒 | dispatcher 指派；技師只看自己的任務 |
| 現場狀態 | 合法／非法轉移與按鈕狀態 | `en_route → on_site → completed` | 技師不可改金額／客戶／組織 | 技師出發、到場、完工 |
| 照片 | 預覽、刪除、錯誤訊息 | MIME、大小、數量、storage failure、重送 | 私有路徑與 signed URL；跨租戶拒絕 | 上傳施工前後照並可重新開啟 |
| 完工 | 必要條件與阻擋原因 | checklist／照片／狀態交易一致性 | event append-only；角色不足被拒 | 未完成條件不可完工；補齊後可完工 |
| 工程追加簽認 | 金額與唯讀版本 | 建立、送出、公開接受、重複接受 | token scope、過期／撤銷、版本不可變 | 業者送出；客戶簽認；留下稽核證據 |
| 通知 | template render | outbox、重試、dead-letter、去重 | 租戶隔離；狀態 transition constraint | fake provider 顯示預期通知紀錄 |
| 並行與冪等 | idempotency key builder | 同 key 重送、雙擊、timeout retry | unique constraint 防重 | submit 連點不產生兩筆資料 |

每一列至少包含：happy path、validation、unauthenticated、unauthorized、wrong tenant、duplicate request、dependency failure 七類案例；不適用者需在 PR 說明原因。

## 7. SQL 與 RLS 負向測試

RLS 是 release blocker。至少驗證：

1. `anon` 無法列出任何內部資料；公開報價／追加單僅能以有效、限範圍 token 取得客戶可見欄位。
2. Alpha owner 可以操作 Alpha 資料，但查不到、更新不到、刪不到 Beta 資料。
3. Alpha member 不能把 `organization_id` 改成 Beta，也不能建立指向 Beta customer、location、project 或 work order 的外鍵。
4. technician 只能讀取自身有效 assignment 所需資料；不可讀內部成本、其他技師工單、line channel secret、membership 與付款管理欄位。
5. dispatcher 可管理進件、報價與指派，但 owner/admin-only 操作仍被拒絕。
6. `quote_version`、已送出的 `change_order` 與 `event` 稽核紀錄不可原地修改或刪除。
7. signed URL 只能針對授權物件產生，照片 bucket 不公開列目錄。
8. public token 過期、撤銷、資源不符或已使用時失敗，且回應不洩漏資源是否存在。
9. 停用 membership 後舊 JWT 也無法繼續存取。
10. migration 從空資料庫執行成功；同版本不重複套用；constraint 名稱與錯誤可被 API 映射。

測試需明確斷言「回傳 0 筆／被拒絕且資料未改變」，不能只斷言拋出任意錯誤。

## 8. API 整合測試準則

- 驗證成功狀態碼、錯誤狀態碼、response schema、header 與資料庫最終狀態。
- `400/422` 用於輸入問題、`401` 未登入、`403` 無權限、`404` 無權限或不存在的防枚舉回應、`409` 版本／狀態衝突、`429` 流量限制；細節以 API 規格為準。
- mutation 接受 `Idempotency-Key` 時，同租戶同 key 與相同 payload 只產生一次副作用；同 key 不同 payload 回 `409`。
- 更新須測 optimistic concurrency（例如 `version` 或 `updated_at`）；舊版本寫入不得覆蓋新資料。
- 完工 API 對 checklist、照片與工單狀態做同一 transaction 驗證，不可部分成功。
- 外部通知採 outbox：商業 transaction 成功不等於通知已送達；測試兩者狀態與重試上限。
- DB、Storage、LINE fake 分別注入 timeout、4xx、5xx 與 malformed response，確認錯誤可重試性與 UI 文案。
- 列表測 pagination、穩定排序、邊界 limit 與無權限 filter；不可用 client filter 補救租戶隔離。

## 9. Playwright 關鍵旅程

### 9.1 Concierge demo（每次 PR smoke）

1. owner 以手機 viewport 登入 Alpha。
2. 手動建立一筆客戶進件，含聯絡方式、服務地址、需求與偏好時段。
3. 從進件建立報價草稿，加入服務項目並確認總額。
4. owner 送出報價；客戶公開頁接受報價。
5. dispatcher 將案件轉為 work order，選擇日期並指派技師 A。
6. 技師 A 只看到自己的任務，依序標記出發、到場。
7. 技師上傳至少一張施工前與一張施工後照片，完成必要 checklist。
8. 技師完成工單；owner 工作台顯示完成並保留完整事件時間線。

至少有一個反向 E2E：技師 B 直接貼上工單 URL，頁面顯示無權限或不存在，API 亦不回資料。

### 9.2 工程追加簽認（合併至 Phase 2 前）

1. owner 在既有 project 建立追加項目與金額。
2. 送出後內容轉唯讀並產生客戶公開連結。
3. 客戶查看正確版本與總額後簽認。
4. 重整或重送不會建立第二次簽認。
5. owner 看到接受者、版本、時間與事件紀錄；後續修改須建立新版本／新追加單。

### 9.3 瀏覽器與裝置

- PR：Chromium，390 × 844 mobile viewport。
- main／nightly：Chromium desktop、Chromium mobile、WebKit mobile。
- staging release：實機 iOS Safari／LINE in-app browser 至少各一次人工 smoke，並保存版本與結果。

## 10. 可及性與非功能測試

- 表單欄位有可讀 label、錯誤與欄位關聯，僅鍵盤可完成 owner 主流程。
- dialog、drawer、toast 與 loading 狀態能被輔助科技辨識；焦點不遺失。
- 色彩對比至少 WCAG 2.1 AA；狀態不可只靠顏色。
- 390px 寬度不得水平溢出；觸控目標原則上至少 44 × 44px。
- 一般 API 在測試資料規模下 p95 低於 500ms；建立報價／完成工單 p95 低於 1s（不含外部通知）。
- 首屏與互動效能以 staging 實測建立 baseline，若 PR 造成 20% 以上退化需說明或修復。
- 上傳中斷可重試，失敗不得留下顯示成功但無 object 的照片紀錄。

## 11. CI 指令契約

Phase 0 已在 `package.json` 建立下列穩定指令；本機與 CI 使用同一組入口：

```bash
npm ci
npm run lint
npm run typecheck
npm run test:unit
npm run test:coverage
npm run test:integration
npm run test:sql
npm run lint:db
npm run test:e2e
npm run build
```

建議對應：

```json
{
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest",
    "test:unit": "vitest run --exclude 'tests/integration/**' --exclude 'tests/e2e/**'",
    "test:coverage": "vitest run --coverage",
    "test:integration": "vitest run tests/integration",
    "test:sql": "supabase test db",
    "lint:db": "supabase db lint --local --level warning",
    "test:e2e": "playwright test"
  }
}
```

實際 Vitest project 名稱可調整，但 CI 與開發者入口不得各自使用不同流程。

### 11.1 CI stages

1. **fast checks**：install、lint、typecheck、unit/component、coverage。
2. **database**：啟動 Supabase、空庫 migration/seed、SQL/RLS 與 database lint。
3. **browser**：build／啟動 app、載入 seed、Playwright smoke。
4. **artifact**：上傳 coverage、Playwright trace／screenshot（失敗時）、migration log。
5. **main/nightly**：完整瀏覽器矩陣與 staging external-adapter smoke。

任一 required job 失敗不得合併。Coverage 比主分支下降且低於門檻時也不得合併。

## 12. Flaky、失敗與證據管理

- PR CI 預設不自動重跑來掩蓋 flaky；Playwright 可在 CI retry 一次，但第一次失敗仍記錄並追蹤。
- 同一測試 14 天內非預期失敗兩次即標記 flaky defect，指定 owner 與修復期限。
- 不得長期 quarantine 主流程、RLS 或金額測試；若 release 前無法修復，該功能不發布。
- E2E 失敗保存 trace、screenshot、video（需要時）與瀏覽器 console；API 失敗保存已遮罩 request ID 與 server log。
- snapshot 僅用於穩定序列化輸出；核心金額、權限與 UI 行為使用明確 assertion。

## 13. 測試 Definition of Done

一個 story 只有在下列全部成立時才算完成：

- 驗收條件已有可追蹤測試，且測試先於或與實作同一 PR 提交。
- happy path、輸入錯誤、未登入、角色不足、跨租戶、重複請求與依賴失敗已涵蓋。
- 必要單元、元件、API、SQL/RLS 與 E2E 層級均通過；省略層級需在 PR 說明。
- 四項 coverage 均達 80%，關鍵商業／安全邏輯達 100% 可達分支。
- 無真實秘密或個資進入 fixture、log、trace、screenshot。
- 文件、seed、migration、API schema 與錯誤碼同步更新。
- CI 全綠，reviewer 能用 README／文件中的單一指令在乾淨環境重現。
