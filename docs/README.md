# Renoly v2 規格索引

Renoly v2 是給 2–10 人小型工程與到府服務團隊使用的 LINE-first「接單到收款」工作台。產品採共通核心搭配產業模板：第一波聚焦冷氣、水電、抓漏／防水，但資料模型保留到府服務與小型工程兩種工作模式。

## 文件地圖

| 文件 | 內容 | 主要讀者 |
|---|---|---|
| [product-spec.md](product-spec.md) | 產品定位、範圍、角色、指標、非目標 | 全體 |
| [business-plan.md](business-plan.md) | GTM、試點收費、單位經濟、情境與擴張門檻 | 創辦人、產品、業務 |
| [domain-glossary.md](domain-glossary.md) | 領域詞彙、UI 投影、API/DB 狀態映射 | 全體 |
| [user-journeys.md](user-journeys.md) | 老闆、派工員、技師、客戶的端到端旅程 | 產品、設計、QA |
| [frontend-spec.md](frontend-spec.md) | 資訊架構、頁面、元件、狀態與 RWD | 前端、設計、QA |
| [architecture.md](architecture.md) | 系統邊界、模組、資料流與整合策略 | 全端、維運 |
| [database-spec.md](database-spec.md) | PostgreSQL schema、狀態機、索引、RLS | 後端、資料庫 |
| [api-spec.md](api-spec.md) | REST API 合約、驗證、錯誤與冪等 | 前後端、QA |
| [openapi.yaml](openapi.yaml) | OpenAPI 3.1 機器可讀合約與 DTO | 前後端、QA、整合夥伴 |
| [security.md](security.md) | 威脅模型、權限、秘密、媒體與 LINE 安全 | 全端、維運 |
| [acceptance-criteria.md](acceptance-criteria.md) | 功能層級驗收條件 | 產品、QA |
| [testing-strategy.md](testing-strategy.md) | TDD、測試層級、coverage、CI 與 fixtures | 開發、QA |
| [implementation-plan.md](implementation-plan.md) | 階段、相依性、agent 邊界與 Definition of Done | 開發、管理 |
| [delivery-status.md](delivery-status.md) | 已交付、尚未整合、release gates 與下一輪順序 | 全體 |

## 規格優先順序

發生衝突時，依以下順序裁決：

1. `security.md` 的安全與租戶隔離要求。
2. `database-spec.md` 的資料完整性與狀態機。
3. `api-spec.md` 的外部合約。
4. `domain-glossary.md` 的跨層映射。
5. `product-spec.md` 與 `user-journeys.md` 的使用者結果。
6. `frontend-spec.md` 的呈現細節。

任何合約變更必須同步更新相關測試與文件；不能只修改實作。

## v2 固定決策

- Clean-slate：舊 Supabase 資料庫已刪除，不提供 v1 schema 或資料遷移相容。
- 共通核心：以 `work_orders` 表示一次可執行的現場工作；`projects`、`assets`、`change_orders`、`maintenance_plans` 是依情境選用的模組。
- 多租戶優先：每筆營運資料具有 `organization_id`，所有讀寫都需組織 membership 與角色授權。
- LINE-first 而非 LINE-only：客戶可從 LINE 進入，但工作人員在一般手機瀏覽器也能使用。
- 人工覆核：AI 只能整理草稿，不得自動診斷、定價、承諾工期或對外發送。
- 私有媒體：照片與文件預設私有，僅以短效簽名網址或可撤銷分享 token 提供。
- TDD：新領域規則與 API 必須先有失敗測試；全域 coverage 目標至少 80%。

## 第一個垂直切片

第一個可驗證切片必須完成：

`進件 → 人工確認報價 → 排程／指派 → 技師前後照 → 完工 → 客戶通知`

第二個模板驗證：

`追加工程 → 版本快照 → 客戶簽認紀錄 → 施工證據 → 請款`

在第一個切片通過驗收與測試前，不加入庫存、電子發票、路線最佳化、薪資計算或全自動聊天機器人。
