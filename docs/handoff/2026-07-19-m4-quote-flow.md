# 交接文件 — M4 報價流程（2026-07-19）

> 用途：Codex 額度用完切換到 Claude（或反向）時，讓接手方一分鐘內掌握「現在做到哪、驗證到什麼程度、下一步是什麼」。每完成一段落更新此檔。

## TL;DR

- **M0–M4 已交付、測試並 commit**。使用者已手動測過 M4 報價流程，回報「基本都沒問題」。
- **git HEAD**：`f62dc93 feat: M4 real quote flow`（M4 已由我方 commit）。上一個 `53cd0fd` 是 Codex commit 的 M3（含我方 M3 workflow 產出）。
- 工作區乾淨。branch：`feat/v2-pilot-r0-m1-m2`。**未 push**。
- **進行中**：M5（派工/技師任務/照片/checklist/完工）規劃 workflow 已啟動。

## 目前驗證基線（2026-07-19 一手實跑）

| 指令 | 結果 |
|---|---|
| `npx supabase db reset` | 空庫重建成功（9 migrations + seed） |
| `npm run typecheck` | 通過 |
| `npm run lint` | 0 errors（2 個 v1 遺留 `<img>` warnings） |
| `npm run test:unit` | 98 檔、**653** tests 全綠 |
| `npm run test:sql` | 9 檔、**310** pgTAP 全綠（含 `08_m4_quotes`） |
| `npm run test:integration` | 4 檔、**21** tests 全綠（含 `m4-quote-flow`：create→send→公開接受→轉工單、跨租戶、v2 clone） |
| `npm run test:coverage` | Statements 88.38% / Branches 80.12% / Functions 88.54% / Lines 91.69%（四項 ≥80%） |
| `npm run build` / `build:local` | 皆通過 |
| `npm run test:e2e:local` | **12/12**（warm server）；見下方 E2E 註記 |

### E2E 註記（重要，避免誤判）

`quote-flow.spec.ts` 在 `npm run test:e2e:local` 跑「完整套件」時偶爾在兩個 project 上 fail，卡在「建立並儲存草稿」後等 `重新整理也不會消失` 逾時。**這不是 M4 缺陷**——對「已暖機、已在 3100 跑著的 dev server」單獨重跑兩個 project 都穩定通過：

```bash
PLAYWRIGHT_BASE_URL=http://127.0.0.1:3100 \
  node scripts/with-local-supabase.mjs npx playwright test tests/e2e/quote-flow.spec.ts
# → 2 passed
```

成因是 Playwright 自帶 `webServer` cold-boot 與測試 race（與早前 M1 host-flip 之外的另一類 cold-start flake 同源）。**接手方若看到這條 red，先確認是否 warm server，再判斷。** 待辦：把 quote-flow 的第一個互動加 readiness gate，或讓 CI 先 warm up 再跑。

## Codex 這一輪實際做了什麼

1. **commit 了 M3**（含我方 M3 workflow 的全部產出）到 `53cd0fd`。
2. **修了我 review 發現的 M3 問題**：新增 `202607190002_v2_m3_staff_access_hardening.sql`（staff access 硬化）。
3. **往前做了 M4**（未 commit）：
   - DB：`202607190003_v2_m4_quote_flow.sql` — quotes / quote_versions / quote_items、金額 server 端重算（TS + PG 雙重）、送出版本唯讀、公開接受/拒絕冪等、one-quote-per-service-request 唯一索引。
   - API：`quotes`、`quotes/[id]`、`quote-versions/[versionId]`、`quotes/[id]/versions`、`quotes/[id]/actions/{send,rotate-public-link}`、`service-requests/[id]/quote`、`public/quotes/current` + `/responses`。
   - UI：`quote-editor`、`quote-loader`、`public-quote`、`public-quote-fragment`、`quote-api`、`/app/quotes/[id]`、`/app/inbox/[id]/quote`、`/public/...`。
   - 安全：`requirePublicBearerToken`（公開報價用 Authorization bearer，token 不進 URL）、csrf.ts 追加 production HTTPS 強制。
   - 文件：`docs/manual-test-m4.md`（完整人工驗收手冊）、ADR 0004/0005、openapi/api-spec/database-spec 更新。

## 怎麼在本機測試 M4（給使用者）

dev server 已在背景跑：`http://127.0.0.1:3100`（本機 Supabase + Mailpit 55324）。完整步驟見 [`docs/manual-test-m4.md`](../manual-test-m4.md)，摘要：

1. `/login` 輸入測試信箱 → Mailpit（55324）點 magic link → 建立店家 → 複製公開報修連結。
2. 無痕視窗開連結 → 客戶免註冊送報修。
3. 回 `/app/inbox` 打開案件 → 分流。
4. 「建立／查看正式報價」→ 填品項數量/單價/成本 → 儲存草稿 → owner 勾核准 → 建立客戶分享連結。
5. 無痕開客戶報價連結 → 接受（二次確認）→ 回 owner 頁看到「客戶已接受 v1」→ 轉工單。

## 下一步

- **先讓使用者手動測 M4**（本文件目的）。
- 待決策：M4 的分層 commit（DB → server → UI → 測試 → docs），比照 M0–M3 的 commit 風格；目前 Codex 把 M3 全塞一個 commit，M4 未提交。
- 待辦（非阻斷）：quote-flow E2E 的 cold-boot readiness gate；members route 已由 Codex 補上（M3 交接時的降級項已關閉）。
- 尚未做：M5（工單工作台/排程/技師任務/完工）、M6（LINE webhook）、M7（AI 整理）、M8（收款/回訪/KPI）。

## 給接手 AI 的踩雷提醒

- 本機一律 `dev:local`/`build:local`/`test:e2e:local`——`.env.local` 是 v1 舊檔，指向 **production** Supabase。
- E2E 被踢回 `/login` 或 quote-flow 逾時：先查 3100 埠是否有殭屍/cold server，Playwright `reuseExistingServer` 會重用錯環境。
- 改 gateway/quote schema 後**必跑 `test:integration`**（打真實 RPC）——單元測試的 mock 可能鏡射錯誤的 RPC 形狀（M2 教訓）。
- `idempotency_keys.organization_id` 受 `protect_tenant_identity()` trigger 保護，null→值也算變更；關聯改放 `resource_type/resource_id`。
