# Renoly v2 交付狀態

更新日期：2026-07-18

這份文件區分「已能操作／驗證的程式」與「已定義但尚未接上真實基礎設施的合約」，避免把互動原型誤認成 production-ready SaaS。成熟度分級：`Spec → Demo → Implemented → Verified → Pilot`。

## 目前驗證基線（2026-07-18 晚間實跑，D1–D6 修復後）

- `npm run typecheck`：通過。
- `npm run lint`：0 errors（3 個 v1 遺留 warnings）。
- `npm run test:unit`：52 檔、345 tests 全綠。
- `npm run test:sql`：5 檔、123 pgTAP tests 全綠（含 `04_pilot_intake` 60 tests：冪等 replay/conflict、上傳鑄造限流、token max_uses 上限）。
- `npm run test:integration`：8 tests 通過（含打真實 RPC 的公開進件全鏈路與跨租戶隔離）。
- `npm run test:coverage`：Statements 89.27%、Branches 82.34%、Functions 93.76%、Lines 91.22%（include 已擴至 `src/app/api/v2/**`、`src/components/pilot/**` 等）。
- `npm run build` 與 `npm run build:local`：皆通過。
- `npm run test:e2e:local`：**8/8 全綠**，含 pilot journey（登入 → onboarding → 公開報修 → 接案匣）於 Pixel 7 與 Desktop Chromium。

## 里程碑追蹤表（M0–M8）

| ID | 使用者成果 | 目前狀態 | 完成 Gate |
|---|---|---|---|
| M0 | 規格、Demo、DB、RLS、Domain、測試基線 | Verified | 現有測試維持全綠 |
| R0 | 隔離不相容／不安全的舊 v1 routes | Verified | 12 個 legacy API route 已回 hardened 404、v1 `(auth)` 頁面群 `notFound()`、3 套 regression 測試釘住；純 `npm run build` 已修復（D6 關閉） |
| M1 | 員工登入、建立店家、角色與最小設定 | Verified | magic link 登入（host 一致性修復＋`next` 深連結）、onboarding、settings、rotate；staff mutation 具 CSRF 與 Idempotency-Key 全鏈路；E2E 通過 |
| M2 | 客戶免註冊提交真實報修，老闆看到接案匣 | Verified | TS↔SQL 合約已對齊並以真實 RPC integration 測試釘住；pgTAP 60 tests；E2E（手機＋桌面）通過；照片 private bucket、冪等、限流、稽核鏈生效 |
| M3 | 人工分流、模板快照、客戶／地址／設備確認 | Spec | 原始內容保留；同一進件只能轉一次 |
| M4 | 報價、核准、安全連結與客戶接受 | Spec／Domain partial | domain 純函式（quote-calculation/version/approval、成本剝除 DTO）已建成待接線 |
| M5 | 派工、技師任務、照片、檢查表與完工 | Spec／Domain partial | work-order-state domain 已建成待接線 |
| M6 | LINE OA webhook、通知與失敗重試 | Spec／DB partial | 驗章、重送、亂序、斷線 fallback 通過 |
| M7 | 自由訊息聚合與 AI 整理草稿 | Spec | 顯示來源／信心；AI 故障不影響進件 |
| M8 | 收款、設備履歷、回訪、KPI 與 Pilot hardening | Spec／DB partial | 真實試點、監控、備份與刪除流程通過 |

關鍵里程碑：M2 完成＝第一次真的能收單；M4 完成＝可成交；M5 完成＝真實營運流程可跑完；M6 完成＝真正 LINE-first；M7 完成＝開始降低人工整理時間。

## 本輪（pilot 切片 R0+M1+M2）已交付

| 範圍 | 狀態 | 可驗證結果 |
|---|---|---|
| v1 隔離（R0） | Implemented | `src/server/supabase/quarantine.ts` + 12 個 legacy API route 統一 hardened 404；`(auth)` layout `notFound()`；`legacy-api-quarantine.test.ts`、`legacy-page-quarantine.test.tsx` 釘住 |
| DB pilot intake（M2 SQL 側） | Verified | `202607160005_v2_pilot_intake.sql`：private 表 FORCE RLS＋REVOKE ALL、7 個 authenticated RPC、5 個 service-role-only 公開 RPC（idempotency replay、5 次/15 分 rate limit、hash-chain 稽核）；`04_pilot_intake.test.sql` 49 tests |
| Supabase 存取層 | Verified | env 驗證、SSR client、service-role client（唯一 consumer：gateway）、Next 16 proxy 守 `/app/*`、public token mint-raw/store-hash |
| v2 API routes | Implemented | health、session、organizations、settings（If-Match 樂觀鎖）、service-requests inbox、public-intake-link rotate、公開 intake 四條；RFC-9457、bounded body、strict Zod |
| Zod 合約 | Implemented | 6 模組 `.strict()`＋colocated 測試；台灣手機 E.164 正規化、honeypot、≤3 照片 |
| Pilot UI | Implemented | login、onboarding、inbox、settings（rotate 一次性 URL）、公開報修表單（sha256→簽名 URL→complete 管線）；19 個元件測試 |
| 測試／CI | Implemented | vitest 80% 門檻、Playwright（Pixel 7＋Desktop）、`with-local-supabase.mjs`、pilot E2E journey、OpenAPI contract test、CI 三 job |

## 缺陷狀態（2026-07-18 晚間）

- **D1 已修復**：auth callback 不再信任 `request.url` 推 origin，改由共用 helper（`NEXT_PUBLIC_APP_URL` → Host/X-Forwarded 白名單驗證 → dev fallback）；`/login?next=` 深連結經 `safeStaffPath` 驗證後全鏈路傳遞（表單 hidden 欄位 → server action → emailRedirectTo）。E2E 通過釘住。
- **D2／D3 已修復**：gateway 五處 schema 對齊真實 RPC 形狀（config 由新 migration `202607180001` 擴充回傳 merchantName/headline/privacyNotice）；inbox schema 重寫並解析 `status/limit`、誠實計算 `hasMore`、渲染 `contactPhone`；onboarding 不再送 `locale`。以 `tests/integration/` 真實 RPC 全鏈路測試（8 tests）防回歸。
- **D4／D5 已修復**（migration `202607180002`）：create organization 與 rotate RPC 接上 `Idempotency-Key`（replay 回存 response、異 body 409 conflict、pgTAP 釘住）；上傳 TTL 對齊 DB 30 分鐘；`PILOT_INTAKE_SESSION_CONFLICT` → 409；photo-upload 鑄造加 token+IP 時窗限流；XFF 處理硬化；token `max_uses` 上限 500；staff mutation 實作 CSRF double-submit（`src/server/api/csrf.ts`）。
- **D6 已修復**：v1 遺留 module-scope env 讀取改為 lazy，純 `npm run build` 通過。**注意**：`.env.local` 仍為 v1 舊檔且指向 production Supabase——本機請一律使用 `npm run dev:local`／`build:local`／`test:e2e:local`（README 已註記）。
- **D7 已修復（infrastructure）**：CI e2e job 改為啟動 local Supabase 並走 wrapper；integration 測試移入 database job（stack 已就緒處執行）；coverage include 擴大且四項門檻達標；`demo-app.workflow.test.tsx` timeout 已調整。

## 2026-07-18 對抗式 code review 結果（已全數修復）

三鏡頭（security／correctness／consistency）14 項發現，逐項對抗驗證後 9 項確認為真並修復、2 項駁回：

1. **XFF 截斷保留左端可偽造項**（`security.ts`）：`slice(0,20)` 改為 `slice(-20)`，補 >20 hop 邊界測試——否則持連結者可輪換假 IP 繞過所有 per-IP 限流。
2. **冪等 replay 回傳死連結**（create organization）：retry 的 token hash 從未入庫，回傳的報修連結必 404。修法：replay 分支將本次 hash 補寫入 `public_access_tokens`（pgTAP 釘住，SQL 124 tests）。
3. **slug 重複回 500 而非 409**：DB 實際拋 `PILOT_ORGANIZATION_CONFLICT`，mapper 未涵蓋（單元測試 mock 了 DB 不會發的訊息）。已修＋以真實訊息補測。
4. **settings 邊界漂移**：TS 200/5000 vs SQL 160/2000 → 對齊 160/2000（schema＋表單 maxLength＋邊界測試）。
5. **addressLine 500 vs SQL 300** → 對齊 300。
6. **CSRF origin 在 production 缺 `NEXT_PUBLIC_APP_URL` 時靜默退化** → 改為 fail-loud（500 `CONFIG_INVALID`）。
7. **CI quality job 無 Supabase 卻跑 integration** → 移入 database job。
8. **openapi 公開 intake 三個 schema 與實作漂移**（categories vs serviceCatalogItems、缺 submissionId/honeypot、complete 形狀）→ 對齊實作，schema pin 更新為 256。
9. 駁回：auth callback proto 降級（有 proto 驗證）；rotate 二次點擊 409（key 每次 mutation 重生）。

### Backlog（非本輪範圍）

- 接案匣深分頁：目前單頁上限 100 筆、無 cursor；超過 100 筆待處理案件時較舊項目不可見。試點店家量級下可接受，M3 前補 keyset pagination（RPC overload＋`nextCursor`）。
- `.env.local` 為 v1 舊檔且指向 production Supabase：建議改名封存（如 `.env.v1-production.bak`）以免誤用純 `npm run dev`；因屬使用者本機檔案，未代為變更。
  - **已裁決／已處理（2026-07-18）**：`src/server/services/public-intake.ts`＋`src/schemas/service-request.ts`（含測試）確認零 production import、無獨有邏輯需保留，判定為被 `src/server/public-intake/gateway.ts` 取代的平行實作並刪除；決策記於 [ADR 0003](adr/0003-public-intake-gateway-over-repository.md)。`src/server/domain/**` 與 `src/schemas/work-order.ts` 屬 M4/M5 既定 scaffolding，保留；本輪同時把 `work-order.ts` 的 `schedule` action 對齊 domain `WORK_ORDER_ACTIONS`（新增測試）。`docs/openapi.yaml` 已補 `/organizations/{orgId}/settings`（GET/PATCH）與 `/organizations/{orgId}/public-intake-link/actions/rotate`（POST）兩條實作端點與對應 schema，contract test pin 更新為 117 paths／158 operations／253 schemas；其餘 session／organizations POST／service-requests GET／四條公開 intake 端點原本即在合約內。`.env.example` 先前標示的「零 consumer secret」實為 `docs/security.md §8.1` 列為啟動必驗的必要秘密（consumer 隨 M6／M8 milestone 才接線），故保留不刪，僅補上 `.env.local` 指向 production 的警告與 `PILOT_MAIL_SERVER_URL`。

## 目前 Sprint（唯一目標）

> 讓一位免註冊客戶送出真實報修，讓已登入的 owner 從真實 PostgreSQL 接案匣看到同一筆資料。

驗收條件：

- Owner 可以登入並建立店家；重登保留。
- Owner 可設定至少一個服務與公開表單；系統產生店家報修連結。
- 客戶以無痕視窗、不註冊即可送出（姓名、電話、地址、問題、時段與照片）。
- 重新整理後資料仍存在；重複送出只建立一筆。
- 另一個 organization 完全讀不到；照片存在 private storage。
- Owner 可人工確認並標記已分流。
- 手機 Playwright、API integration、SQL/RLS 測試全通過。

## Release gates

進入真實店家 pilot 前，至少全部滿足：

1. 全新資料庫可由空環境 `supabase db reset` 成功建立。
2. pgTAP 跨租戶、角色、不可變版本、完工證據與 public token 負向測試全綠。
3. 安全 red-team 列出的 high findings 全部關閉或從 Phase 1 surface 移除。
4. 實作第一條 production API vertical slice，不只停在 interface／domain。
5. 使用測試 LINE channel 完成 webhook replay、簽章失敗、通知 retry 測試。
6. private media 驗證 object path、MIME、size、hash、短效 URL 與撤銷。
7. staging 以兩個 organization 做跨租戶手動測試與 pilot 資料刪除演練。
8. 手機實機至少驗證 iOS Safari、Android Chrome、LIFF WebView。

互動 demo（`/demo`）使用本地 fixture，畫面已明示不會連資料庫或發 LINE。它的目的，是讓店家在付款試點前能親手驗證流程，不是用假資料冒充已完成整合。
