# Renoly v2 領域詞彙與跨層映射

本文件固定產品中文、前端 read model、API resource 與資料庫狀態之間的對應。畫面不應直接把資料庫 enum 翻譯後顯示；API 也不應為了配合某一頁而新增重複的 aggregate。

## 1. 三種層級

| 層級 | 用途 | 例子 |
|---|---|---|
| 領域 aggregate | 寫入、狀態機、權限與交易邊界 | `service_request`、`project`、`work_order` |
| API resource | 對 aggregate 的安全操作介面 | `/service-requests`、`/projects`、`/work-orders` |
| UI read model | 讓小團隊以工作語言理解多個 aggregate | 「案件」、「今日任務」、「待我處理」 |

中文「案件」是 UI read model，不建立 `cases` 資料表：

- 尚未轉換的詢問以 `service_request` 為主體。
- 單次到府服務轉換後以 `work_order` 為執行主體，仍保留來源 request。
- 多日工程轉換後以 `project` 為商業容器，底下有多張 work order。
- `/app/cases/[caseKey]` 可使用 `{type}:{id}` 或 server 產生的 opaque key；不可假設三種資源共用同一 UUID。

## 2. 角色

Phase 1 對店家開放三個角色：

| 角色 | 產品名稱 | 核心權限 |
|---|---|---|
| `owner` | 老闆／管理者 | 全店設定、核准報價、敏感更正與營運資料 |
| `dispatcher` | 行政／派工 | 進件、客戶、報價草稿、排程、通知與回訪 |
| `technician` | 技師 | 僅被指派工單的現場資料、狀態、檢查與照片 |

技術 allowlist 預留 `admin`、`accountant`、`viewer`，但 Phase 1 不可從 UI 指派。啟用任何預留角色前，必須完成該角色 API、field redaction、RLS 負向測試與使用者研究。

客戶不是 membership；客戶只透過 scoped、可撤銷、可到期的 public capability token 操作指定資源。

## 3. 案件階段是投影，不是另一套狀態機

案件階段由 request/project/work order/quote/payment 的事實投影而成，並保存人工 override event。它不應反向以通用 PATCH 強改所有子資源。

### 3.1 到府服務投影

| UI 階段 | 最低領域事實 |
|---|---|
| 待處理 | request `new` |
| 待補資料 | request `triaged`，但缺報價／排程必要資料 |
| 待報價／待現勘 | request `triaged` 或 `quoting` |
| 待客戶確認 | 有已核准且已送出的 active quote version |
| 待排程 | request `converted`，work order `draft` |
| 已排程 | work order `scheduled` 或 `dispatched` |
| 進行中 | 任一 work order `on_site/paused`；`en_route` 仍投影為已排程並顯示「技師已出發」 |
| 待收款 | 必要 work order `completed` 且有未結清 milestone |
| 已完成 | 必要 work order完成，應收結清或具核准例外 |

### 3.2 小型工程投影

| UI 階段 | 最低領域事實 |
|---|---|
| 新詢問／待現勘／報價中 | request `new/triaged/quoting` |
| 待客戶確認 | quote `sent/viewed` |
| 待開工 | project `active`，但沒有進行中工單 |
| 施工中 | project `active` 且有工單 `on_site/paused`；出發中仍保留待開工投影 |
| 待驗收 | 施工工單完成，尚缺 sign-off event |
| 待收款 | 有 `invoiced/overdue` milestone |
| 保固中／已結案 | project `completed`，依 warranty/maintenance 是否有效投影 |

## 4. 工單狀態與畫面標籤

Canonical write state：

`draft → scheduled → dispatched → en_route → on_site ↔ paused → completed`

`cancelled` 是例外終態；`completed → on_site` 只允許 owner 在時限內附理由 reopen。

| DB/API 狀態 | 預設 UI 標籤 | 可由其他事實細分 |
|---|---|---|
| `draft` | 未排程 | — |
| `scheduled` | 已排程 | assignment accepted 可顯示「技師已確認」 |
| `dispatched` | 已派工 | 客戶 appointment event 可顯示「預約已確認」 |
| `en_route` | 已出發 | — |
| `on_site` | 已到場 | checklist 有作答後可顯示「施工中」；必要項完成但未簽認可顯示「待確認」 |
| `paused` | 暫停處理 | reason/event 決定「待料」、「需再訪」等標籤 |
| `completed` | 已完工 | completion outcome 可顯示「需再訪」並關聯下一張工單 |
| `cancelled` | 已取消 | cancellation reason code 可顯示「客戶未到」等結果 |

「施工中」、「待確認」、「未到場」、「需再訪」在 Phase 1 是由 checklist、sign-off、reason event 或後續工單投影的營運標籤，不新增可任意跳轉的 DB status。若試點數據證明它們需要獨立 SLA，再以 ADR 升格為 canonical state。

## 5. 報價有兩條互相獨立的狀態

報價／版本的 customer lifecycle：

- quote：`draft/sent/viewed/accepted/rejected/expired/cancelled`
- version：`draft/sent/superseded/accepted/rejected/expired/cancelled`

內部人工核准 lifecycle：`not_submitted → pending → approved`，或 `pending → changes_requested → not_submitted`。

- dispatcher 可編輯草稿並送審，但不能自行繞過 owner/admin 核准。
- owner/admin 可核准，或在單一交易中 approve-and-send。
- 影響金額、條款、客戶可見說明的修改會讓核准失效。
- 只有 version `approval_status=approved` 才能送給客戶。
- 送出後內容不可原地修改；修訂 clone 新版本並重新核准。

這裡的「AI 產生報價」永遠只代表建立或更新 draft，不代表 approved 或 sent。

## 6. 追加與收款

Phase 1 canonical change order state 是 `draft/sent/accepted/rejected/cancelled`。產品文案的「待內部核准」由 draft approval metadata 投影，「待客戶確認」對應 sent。未 accepted 的金額不得進 contracted amount 或 payment milestone。

Payment milestone 使用 `pending/invoiced/overdue/paid/waived/cancelled`：

| UI | Technical |
|---|---|
| 未開立 | `pending` |
| 待付款 | `invoiced` |
| 已逾期 | `overdue` |
| 已付款 | `paid` |
| 已作廢／免收 | `cancelled/waived` |

「部分付款」是同一應收下的付款紀錄加總投影；在 payment allocation table 尚未實作前，Phase 1 不顯示可操作的部分付款功能。

## 7. 不可變資料與事件

- quote/change order 送出版本是不可變快照。
- event 是 append-only，不接受 update/delete。
- 狀態變更走 action/transition endpoint，不接受一般 PATCH 直接指定 `status`。
- UI 標籤變更若沒有對應 domain event，不得假裝已完成交易。
- 所有客戶確認保存 resource/version、token id、時間、顯示名與最小必要的稽核 metadata，但不宣稱一般點擊等同特定法律形式的電子簽章。

## 8. 實作檢查

新增功能時至少回答：

1. 它修改哪個 aggregate，還是只是 UI projection？
2. transition 的角色、前置條件與副作用是什麼？
3. 跨租戶資源如何由 API、RLS、composite FK 三層拒絕？
4. 是否需要 `If-Match`、`Idempotency-Key`、event 或 outbox？
5. public DTO 是否以 allowlist 建立，且沒有成本、內部備註或其他客戶資料？
