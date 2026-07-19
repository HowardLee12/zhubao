# Renoly v2

給台灣 2–10 人小型工程與到府服務團隊使用的 LINE-first 接案到收款工作台。

Renoly 不只面向冷氣業。冷氣、水電與抓漏防水是第一波驗證模板；共通核心是進件、報價、排程、工單、現場證據、追加、收款與回訪。客戶從 LINE 開啟安全網頁，不必安裝 App；店內成員使用手機優先 PWA。

## 目前階段

此 repository 正由 v1 裝修原型重建為 v2 clean-slate 架構。舊資料庫已刪除，v2 不提供舊 schema 相容；舊畫面暫時保留作為可重用 UI 資產，新程式使用獨立的 v2 目錄與 `/api/v2` contract。

完整決策從 [v2 文件索引](docs/README.md) 開始閱讀。重要文件包括：

- [產品規格](docs/product-spec.md)
- [商業計畫](docs/business-plan.md)
- [領域詞彙與狀態映射](docs/domain-glossary.md)
- [前端規格](docs/frontend-spec.md)
- [API 規格](docs/api-spec.md)
- [OpenAPI 3.1 合約](docs/openapi.yaml)
- [資料庫規格](docs/database-spec.md)
- [安全規格](docs/security.md)
- [測試策略](docs/testing-strategy.md)
- [實作計畫](docs/implementation-plan.md)
- [目前交付狀態與 release gates](docs/delivery-status.md)
- [驗收條件](docs/acceptance-criteria.md)

## 技術棧

- Next.js 16 App Router、React 19、TypeScript、Tailwind CSS 4
- Supabase Auth、PostgreSQL、Storage
- Zod、Vitest、Testing Library、Playwright、pgTAP
- LINE LIFF / Messaging API（真實店家串接在 pilot 階段啟用）

## 本機啟動

需求：Node.js 20+、npm；需要資料庫整合測試時另安裝 Supabase CLI 與 Docker。

```bash
npm install
cp .env.example .env.local
npm run dev:local
```

> ⚠️ **本機開發請用 `:local` 指令。** 這個 repo 既有的 `.env.local` 可能是 v1 時期留下的舊檔，並指向「正式（production）」的 Supabase 專案。直接 `npm run dev` / `npm run build` / `npm run test:e2e` 會打到正式資料庫。本機工作請一律改用會注入本機 Supabase 環境（API `127.0.0.1:55321`、mail `127.0.0.1:55324`）的封裝指令：`npm run dev:local`、`npm run build:local`、`npm run test:e2e:local`（皆透過 `scripts/with-local-supabase.mjs`）。

可操作的無資料庫 vertical-slice demo 位於 `/demo`。它使用明確標示的本地示範資料，不會連到 production 或真實客戶。

## 品質指令

```bash
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

`test:sql` 需要本機 Supabase 已啟動；Playwright 首次使用需先執行 `npx playwright install chromium`。

## 開發原則

- TDD：先有失敗測試，再做最小實作與重構。
- Phase 1 店內角色只有 `owner`、`dispatcher`、`technician`。
- AI 只能產生草稿；報價、派工、通知與完工需要人工確認。
- 所有營運資料以 `organization_id` 隔離，API、RLS、composite FK 三層驗證。
- 報價／追加的送出版本與稽核事件不可覆寫。
- 照片預設私有，只使用短效 signed URL 或 scoped public token。
- 成本、內部備註、secret、service-role key 永不送到瀏覽器。

更多工作慣例見 [CLAUDE.md](CLAUDE.md)。
