# Renoly v2 交付狀態

更新日期：2026-07-19

這份文件區分「已能操作／驗證的程式」與「已定義但尚未接上真實基礎設施的合約」，避免把互動原型誤認成 production-ready SaaS。成熟度分級：`Spec → Demo → Implemented → Verified → Pilot`。

## 目前驗證基線（2026-07-19 實跑，M3 交付後）

- `npm run typecheck`：通過。
- `npm run lint`：0 errors（3 個 v1 遺留 warnings）。
- `npm run test:unit`：80 檔、528 tests 全綠。
- `npm run test:sql`：8 檔、234 pgTAP tests 全綠（含 `04_pilot_intake` 49 tests；M3 `05_m3_triage` 42、`06_m3_transition_service_request` 12、`07_m3_staff_access_hardening` 56 tests：triage 綁定／內部備註／可指派角色、convert-once、模板快照、原始內容不可變、authenticated-only staff projection、跨租戶、摘要稽核與真實 customer create）。
- `npm run test:integration`：19 tests 通過（公開進件全鏈路＋跨租戶隔離；M3 打真實 RPC 的 triage 成功/角色拒/stale version、convert 建工單＋checklist 快照、convert replay 回既有 case）。
- `npm run test:coverage`：Statements 89.97%、Branches 81.59%、Functions 93.70%、Lines 93.36%（四項門檻皆 ≥80%）。
- `npm run build` 與 `npm run build:local`：皆通過（含新 `/app/inbox/[id]`、`service-requests/[id]/**` action routes、`customers/**` read routes）。
- `npm run test:e2e:local`：**10/10 全綠**（5 spec × Pixel 7／Desktop Chromium），含 pilot intake journey 與 M3 `triage-convert`（onboarding → 免註冊進件 → 開單詳情看不可變原始＋可編輯摘要 → 分流 → 轉工單 → 顯示持久化案件編號且不可再轉 → reload 仍讀回同一編號；M5 前不顯示死連結）。

## 里程碑追蹤表（M0–M8）

| ID | 使用者成果 | 目前狀態 | 完成 Gate |
|---|---|---|---|
| M0 | 規格、Demo、DB、RLS、Domain、測試基線 | Verified | 現有測試維持全綠 |
| R0 | 隔離不相容／不安全的舊 v1 routes | Verified | 12 個 legacy API route 已回 hardened 404、v1 `(auth)` 頁面群 `notFound()`、3 套 regression 測試釘住；純 `npm run build` 已修復（D6 關閉） |
| M1 | 員工登入、建立店家、角色與最小設定 | Verified | magic link 登入（host 一致性修復＋`next` 深連結）、onboarding、settings、rotate；staff mutation 具 CSRF 與 Idempotency-Key 全鏈路；E2E 通過 |
| M2 | 客戶免註冊提交真實報修，老闆看到接案匣 | Verified | TS↔SQL 合約已對齊並以真實 RPC integration 測試釘住；pgTAP 60 tests；E2E（手機＋桌面）通過；照片 private bucket、冪等、限流、稽核鏈生效 |
| M3 | 人工分流、模板快照、客戶／地址／設備確認 | Verified | 兩 completion gate 有測試佐證：原始內容保留（`original_submission` 寫入即鎖 guard trigger＋pgTAP）、同一進件只能轉一次（convert-once return-existing，integration replay＋E2E 二次轉換釘住）；接案匣 keyset 深分頁補齊；triage/convert/transition RPC＋detail/actions/customers routes＋詳情 UI 全鏈路；E2E（手機＋桌面）通過 |
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
| Supabase 存取層 | Verified | env 驗證、SSR client、Next 16 proxy 守 `/app/*`、public token mint-raw/store-hash；service-role 僅 public capability gateway 與 private Storage signer，staff domain route 全走 authenticated RPC |
| v2 API routes | Implemented | health、session、organizations、settings（If-Match 樂觀鎖）、service-requests inbox、public-intake-link rotate、公開 intake 四條；RFC-9457、bounded body、strict Zod |
| Zod 合約 | Implemented | 6 模組 `.strict()`＋colocated 測試；台灣手機 E.164 正規化、honeypot、≤3 照片 |
| Pilot UI | Implemented | login、onboarding、inbox、settings（rotate 一次性 URL）、公開報修表單（sha256→簽名 URL→complete 管線）；19 個元件測試 |
| 測試／CI | Implemented | vitest 80% 門檻、Playwright（Pixel 7＋Desktop）、`with-local-supabase.mjs`、pilot E2E journey、OpenAPI contract test、CI 三 job |
| M3 DB 層 | Verified | `202607190001_v2_m3_triage_convert.sql`：category／staff-only internal note／immutable original submission／provenance、convert-once、triage／convert／literal similar-customer search／keyset inbox；`202607190002_v2_m3_staff_access_hardening.sql`：8 個 authenticated-only projection/mutation RPC、manager/tenant guard、summary row lock＋event、可指派 operational members、transactional customer create＋流水號＋audit；M3 pgTAP 110 tests |
| M3 API 層 | Implemented | detail `GET`/`PATCH`（If-Match、summary-edit 存證、完整 workspace）、`actions/{triage,start-quoting,mark-quoted,decline,cancel,convert}`、`events`／`photos`、customer list/create/confirmation 與 `/members` 指派名單；staff domain route 無 service-role table query，Storage signer 僅簽 RPC 已授權 metadata；keyset 接案匣回真實 `nextCursor`；OpenAPI 以 pilot DTO 對齊實際 envelope（121 paths／162 operations／287 schemas）；19 integration tests |
| M3 UI 層 | Implemented | `/app/inbox/[id]` 詳情：唯讀原始需求 vs 可編輯摘要、相似客戶 hint（顯示不合併）、真實建立 customer、地址/設備確認、priority/類別/負責人、triage／convert／要求補資料（本地 state + copy，送出 defer M6）／不適用／取消；併發 If-Match 412 toast＋自動 refetch；convert idempotent 顯示資料庫案件編號，M5 前不產生死連結；接案匣 keyset 翻頁 |

## 缺陷狀態（2026-07-18 晚間）

- **D1 已修復**：auth callback 不再信任 `request.url` 推 origin，改由共用 helper（`NEXT_PUBLIC_APP_URL` → Host/X-Forwarded 白名單驗證 → dev fallback）；`/login?next=` 深連結經 `safeStaffPath` 驗證後全鏈路傳遞（表單 hidden 欄位 → server action → emailRedirectTo）。E2E 通過釘住。
- **D2／D3 已修復**：gateway 五處 schema 對齊真實 RPC 形狀（config 由新 migration `202607180001` 擴充回傳 merchantName/headline/privacyNotice）；inbox schema 重寫並解析 `status/limit`、誠實計算 `hasMore`、渲染 `contactPhone`；onboarding 不再送 `locale`。以 `tests/integration/` 真實 RPC 全鏈路測試（8 tests）防回歸。
- **D4／D5 已修復**（migration `202607180002`）：create organization 與 rotate RPC 接上 `Idempotency-Key`（replay 回存 response、異 body 409 conflict、pgTAP 釘住）；上傳 TTL 對齊 DB 30 分鐘；`PILOT_INTAKE_SESSION_CONFLICT` → 409；photo-upload 鑄造加 token+IP 時窗限流；XFF 處理硬化；token `max_uses` 上限 500；staff mutation 實作 CSRF double-submit（`src/server/api/csrf.ts`）。
- **D6 已修復**：v1 遺留 module-scope env 讀取改為 lazy，純 `npm run build` 通過。**注意**：`.env.local` 仍為 v1 舊檔且指向 production Supabase——本機請一律使用 `npm run dev:local`／`build:local`／`test:e2e:local`（README 已註記）。
- **D7 已修復（infrastructure）**：CI e2e job 改為啟動 local Supabase 並走 wrapper；integration 測試移入 database job（stack 已就緒處執行）；coverage include 擴大且四項門檻達標；`demo-app.workflow.test.tsx` timeout 已調整。
- **D8 已修復（M3 security boundary）**：Claude 版本的 staff detail/customer/event routes 先驗 manager 後仍以 service role 直接查 domain table，會繞過 RLS 且 PATCH 未 append event。已改為 migration `202607190002` 的 authenticated-only RPC；PATCH 於同一 transaction 驗 lock、寫 provenance 與 event；service role 僅保留 private Storage 短效簽名。另修正乾淨 seed 缺 `original_submission` 與相似客戶 `%/_` pattern 搜尋問題。
- **D9 已修復（M3 真實流程／競態）**：移除 provisional customer 字串與未存在的案件工作台死連結；inline customer create 改為真實 transaction RPC。React StrictMode／並行負載下的第二次初始載入曾會晚到並覆蓋使用者剛選的 priority、category、internal note 與 assignee；現以 load sequence 丟棄 stale response，並有反序完成單元測試與 5-worker 手機／桌面 E2E 釘住。

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

- ~~接案匣深分頁：目前單頁上限 100 筆、無 cursor；超過 100 筆待處理案件時較舊項目不可見。~~ **已於 M3 關閉**：`list_pilot_service_requests` 新增 keyset overload（`(created_at, id) desc` cursor＋status filter 下推 SQL），接案匣 route 回真實不透明 `nextCursor`（base64url `{createdAt,id}`），pgTAP 以 >100 筆翻頁到底不漏舊 row 釘住。
- ~~詳情頁「指派師傅」下拉缺少 members route。~~ **已於 M3 hardening 關閉**：`GET /api/v2/organizations/{orgId}/members` 由 authenticated-only `list_pilot_assignable_members` RPC 提供 active operational roles；triage DB 同時拒絕 accountant/viewer 成為負責人。完整 memberships 邀請／CRUD 仍依原計畫留待後續。
- `.env.local` 為 v1 舊檔且指向 production Supabase：建議改名封存（如 `.env.v1-production.bak`）以免誤用純 `npm run dev`；因屬使用者本機檔案，未代為變更。
  - **已裁決／已處理（2026-07-18）**：`src/server/services/public-intake.ts`＋`src/schemas/service-request.ts`（含測試）確認零 production import、無獨有邏輯需保留，判定為被 `src/server/public-intake/gateway.ts` 取代的平行實作並刪除；決策記於 [ADR 0003](adr/0003-public-intake-gateway-over-repository.md)。`src/server/domain/**` 與 `src/schemas/work-order.ts` 屬 M4/M5 既定 scaffolding，保留；本輪同時把 `work-order.ts` 的 `schedule` action 對齊 domain `WORK_ORDER_ACTIONS`（新增測試）。`docs/openapi.yaml` 已補 `/organizations/{orgId}/settings`（GET/PATCH）與 `/organizations/{orgId}/public-intake-link/actions/rotate`（POST）兩條實作端點與對應 schema，contract test pin 更新為 117 paths／158 operations／253 schemas；其餘 session／organizations POST／service-requests GET／四條公開 intake 端點原本即在合約內。`.env.example` 先前標示的「零 consumer secret」實為 `docs/security.md §8.1` 列為啟動必驗的必要秘密（consumer 隨 M6／M8 milestone 才接線），故保留不刪，僅補上 `.env.local` 指向 production 的警告與 `PILOT_MAIL_SERVER_URL`。

## 下一 Sprint（M4，唯一目標）

> 讓 owner 從已分流進件建立真實報價版本，讓免註冊客戶透過安全連結接受／拒絕，接受後才能順暢轉成案件。

驗收條件：

- Owner 可從 triaged request 進入報價編輯器，新增品項、數量、單價、稅與備註；計算全部由 server/domain 重算。
- 草稿可修改；每次「送出」建立不可覆寫的 quote version，保存當下客戶可見內容。
- Owner 預覽的客戶版 DTO 不含成本、內部備註、margin 或 service-role 資料。
- 客戶以短效／可撤銷 public token 開啟，不需註冊即可接受或拒絕；重播相同操作不重複寫入。
- request 狀態與 quote event 在同一 transaction 更新；stale `If-Match` 回 412，不得 lost update。
- 接受後 UI 顯示可轉成單次工單／專案；拒絕後仍保留舊 version，可複製成新版再送。
- 跨 tenant、token 洩漏、成本剝除、計算、版本不可變、手機＋桌面完整 E2E 全綠。

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
