# 交接文件 — Pilot 導覽殼 + 成員管理 + 完工 gate 修正（2026-07-20）

## TL;DR

- 修好使用者實測 M5 時撞到的三個缺口：完工回報 500、無法加技師、頁面死路。
- **git HEAD**：`cf69453`。前序 `f0c0afc` M5、`f62dc93` M4、`53cd0fd` M3。
- 工作區乾淨。branch `feat/v2-pilot-r0-m1-m2`，**未 push**。
- 資料庫剛 `db reset`，只有 seed 的 Alpha/Beta（乾淨、無 E2E 垃圾）。

## 這輪修了什麼（都因使用者真實測試而發現）

1. **完工回報 500 → 修好**：一個 M4 時期的 trigger `require_completion_snapshot` 硬性要求「工單完工前必須有 checklist」，害沒 checklist 的簡單工單（只需前後照）無法完工。依使用者決定移除（migration `202607200001`）。完工 gate 仍保留：非空摘要 + 必填 checklist 項答完 + 必要證據 + ≥1 前照 + ≥1 後照。且完工錯誤碼現在正確回 422（原本 500）。
2. **無法加技師 → 修好**（使用者授權「owner 填 email 代建帳號」）：`invite_pilot_member` + `list_pilot_members` RPC（migration `202607200003`）、members route 加 `GET ?scope=all` + `POST`（用 service-role admin API 依 email 建/找登入帳號，manager-gated，禁建 owner）、`/app/settings/team` 成員管理頁。
3. **頁面死路 → 修好**：角色感知 `(pilot-staff)/layout.tsx` + 持久底部導覽；`/app` 對管理者渲染 hub（導覽卡）、技師直接落 `/app/today`；schedule/technician/inbox 補返回連結。

## 驗證基線（2026-07-20 一手實跑）

| 指令 | 結果 |
|---|---|
| `npx supabase db reset` | 成功（12 migrations + seed） |
| typecheck / lint | 通過 / 0 errors |
| `npm run test:unit` | 140 檔、**1004** tests |
| `npm run test:sql` | 11 檔、**408** pgTAP |
| `npm run test:integration` | **26** tests |
| `npm run test:coverage` | **exit 0**（branches 80.5%，四項達標） |
| `npm run build` / `build:local` | 通過 |
| M5 E2E | **serial（workers:1，同 CI）全綠**；parallel 5-worker 會因 dev-server 競用假 fail |

### E2E 重要註記（這輪學到的）

M5 spec 在 **parallel（預設多 worker）** 跑會假 fail——新加的導覽層讓 `/app` 多一次 session fetch，5 個 worker 同時打單一 dev server 時 redirect 到 onboarding 超過 assertion timeout。**CI 用 `workers:1`（serial）不受影響**。本機驗證要用：
```bash
PLAYWRIGHT_BASE_URL=http://127.0.0.1:3100 \
  node scripts/with-local-supabase.mjs npx playwright test tests/e2e/m5-*.spec.ts --workers=1
```
接手方看到 M5 parallel red，先用 `--workers=1` 或單 spec 隔離重跑再判斷。

## 怎麼測（給使用者）— 用預填的 Alpha 店家最省事

**重點：db reset 後不用重建。直接登入 seed 的 Alpha 店家，裡面已有完整資料。**

各角色帳號（都用 magic link 登入，Mailpit `http://127.0.0.1:55324` 收信）：
- **owner**：`alpha.owner@example.test`
- **dispatcher**：`alpha.dispatcher@example.test`
- **技師 A**：`alpha.tech-a@example.test`
- **技師 B**：`alpha.tech-b@example.test`

測 M5：
- **owner/dispatcher** 登入 → `/app`（管理者 hub）→ 底部導覽切 接案匣/排程/成員/設定 → `/app/schedule` 有預填工單可排程。
- **技師 A** 登入 → 自動落 `/app/today` → 只看到自己的工單（W-202607-000003「缺 after 照片」可測 blocked completion；補後照後可完工）。
- **加技師**：owner → 底部導覽「成員」→ `/app/settings/team` → 填 email+姓名+角色新增（會建登入帳號）。
- **例外完工**：owner 在缺項工單上可強制完工（標示「非客戶簽認」）。

想從零走（自建店家）也可以，但 reset 後那些自建資料會消失——**測試建議用 Alpha 帳號**。

## 給接手 AI 的踩雷提醒

- **db reset 會清掉使用者手動建的資料**。背景 agent 的 verify 步驟可能自跑 reset——若使用者正在測，先確認再 reset，或引導使用者用 seed 的 Alpha 帳號（reset 後仍在）。
- 本機一律 `dev:local`/`build:local`/`test:e2e:local`；`.env.local` 指向 production。
- M5 E2E 本機驗證用 `--workers=1`（parallel 會因 dev-server 競用假 fail）。
- 改 route/schema/gateway 後必跑 `test:integration`（真實 RPC，防 mock 漂移）。
- coverage branches 80% 是 hard gate；新增 route.ts 要一併補 route.test.ts（auth/CSRF/validation/error 分支），否則拖垮全域。
- 完工 gate 有多處 checklist 判定經 `private.checklist_item_answered`；改完工邏輯要同步。

## 下一步

- M6（LINE OA webhook/通知/重試）— 目前排程/完工都持久化且標示「未自動發送」。
- 未做：M6、M7（AI 整理）、M8（收款/回訪/KPI）、production hardening。
