# Renoly v2

Renoly 是給台灣 2–10 人小型工程與到府服務團隊使用的 LINE-first 接案到收款工作台。冷氣清洗／維修是首波產業模板，不是產品邊界；首波同時驗證水電與抓漏防水，後續可擴張至家電維修、清潔、油漆、泥作、木工、鐵工與局部裝修。

## 產品承諾

> 把 LINE 裡的工程詢問，變成不漏掉的報價、工單、施工紀錄與收款。

客戶不必安裝 App，從 LINE 開啟需求表單與安全分享頁。owner、dispatcher、technician 使用手機優先 Web App / PWA，完成進件、報價、排程、現場紀錄、完工、收款與回訪。

AI 只能整理與產生草稿；報價、診斷、派工、對客通知、追加與完工都必須經有權限的人員確認。

## 現行技術方向

- Next.js 16 App Router、React 19、TypeScript、Tailwind CSS 4。
- Supabase Auth、PostgreSQL、Storage；所有營運資料以 `organization_id` 做租戶隔離並啟用 RLS。
- LINE 是客戶入口，但核心流程不可依賴 LINE 才能運作。
- Route/UI → application service → domain + repository interface；domain 不依賴 Next.js、React 或 Supabase。
- API 位於 `/api/v2`，使用 Zod 驗證、統一錯誤格式、server-side RBAC、idempotency 與 optimistic concurrency。
- 媒體使用 private bucket 與短效 signed URL；不得公開暴露工作照片。
- 金額使用整數 minor unit，日期儲存 UTC、顯示 `Asia/Taipei`。

## 資料庫重建

舊資料庫已刪除。v2 採 clean-slate schema，不保證舊 `projects`、`trades`、`quotes` 等資料表相容，也不以舊 migration 作為新資料模型的限制。

新的 canonical schema 放在 `supabase/migrations/`，測試資料放在 `supabase/seed.sql`，RLS / pgTAP 測試放在 `supabase/tests/`。舊 SQL 與 v1 程式只能作為可重用 UI／流程參考，不是 v2 的 source of truth。

## v2 文件（source of truth）

- [文件索引](docs/README.md)
- [產品規格](docs/product-spec.md)
- [商業計畫](docs/business-plan.md)
- [領域詞彙與狀態映射](docs/domain-glossary.md)
- [前端規格](docs/frontend-spec.md)
- [使用者旅程](docs/user-journeys.md)
- [系統架構](docs/architecture.md)
- [API 規格](docs/api-spec.md)
- [OpenAPI 3.1 合約](docs/openapi.yaml)
- [資料庫規格](docs/database-spec.md)
- [安全規格](docs/security.md)
- [測試策略](docs/testing-strategy.md)
- [實作計畫](docs/implementation-plan.md)
- [目前交付狀態與 release gates](docs/delivery-status.md)
- [驗收條件](docs/acceptance-criteria.md)

規格衝突時依序以安全、資料庫、API、領域詞彙與狀態映射、產品、前端為準；任何刻意偏離都要新增 ADR。

## 第一個可執行切片

第一階段交付一條可測的 concierge vertical slice：

1. 建立／分流客戶進件。
2. 人工建立並核准報價草稿。
3. 建立工單、排程並指派技師。
4. 技師更新現場狀態、填 checklist、上傳前後照。
5. 完工並留下 append-only event。
6. 客戶公開頁可查看或確認指定資源。

工程模板的第二條驗證流程是：建立追加 → 固定不可變版本 → 客戶確認 → 納入應收與稽核紀錄。

## 開發規則

- 使用 TDD：先寫會失敗的測試，再做最小實作，最後重構。
- 全域 statements、branches、functions、lines coverage 最低 80%；租戶隔離、權限、金額與狀態轉移的可達分支要求 100%。
- 每個 mutation 都要驗證 session、membership、role、resource organization 與目前狀態；不可只依賴前端隱藏按鈕。
- 已送出的報價／追加版本與 event 不可覆寫。
- 不得將 service-role key、LINE channel secret、access token 或成本資料送進瀏覽器。
- 保留既有不相關變更；不要使用 destructive git commands。

## 預期指令

```bash
npm run dev
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

環境變數見 `.env.example`（必要秘密清單以 `docs/security.md §8.1` 為準）；本機開發請用 `:local` 變體（`dev:local`／`build:local`／`test:e2e:local`），它們透過 `scripts/with-local-supabase.mjs` 指向本機 Supabase，避免既有 `.env.local` 打到 production。任何 secret 不得提交。
