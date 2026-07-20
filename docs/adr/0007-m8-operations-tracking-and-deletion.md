# ADR 0007：M8 收款追蹤、設備履歷、保養回訪與資料刪除的設計取捨

- 狀態：Accepted
- 日期：2026-07-20

## 背景

M8 是最後一個里程碑，在既有的 `payment_milestones` / `maintenance_plans` / `assets`
三張表上接 RPC，交付收款追蹤、設備履歷、保養回訪與基本 KPI，並補上試點 hardening
（authenticated 限流、資料刪除／匿名化、retention cleanup）。過程中有數個必須明文記錄的
刻意偏離與 net-new 設計決策。

## 決策

### 1. 收款是「追蹤」不是「金流／總帳」；部分付款本輪 OUT

- `mark_payment_milestone_paid` **不呼叫任何金流閘道**，只推進里程碑狀態。若傳入疑似
  卡號／CVV／銀行密碼欄位（key 命中 `card|cvv|cvc|pan|iban|routing|account_number|
  bank_secret|security_code|expiry`，或值為 13–19 位連續數字），直接 422
  （`PAYMENT_SENSITIVE_FIELD_REJECTED`, errcode `RENSF`）並記一筆不含內容的稽核事件。
- **部分付款（分批收款）明確不做**：需要 `payment_allocation` 表才能正確表達，且 glossary
  §6 與 api-spec §13 皆無 partial-pay action。UI 保留「部分付款」分頁但顯示誠實空狀態
  （「本階段僅追蹤請款／收款狀態，尚未支援分批」）。這是 frontend 讓步給 database／api 的
  **刻意偏離**。
- 金額一律整數 minor unit；`reverse_payment_milestone`（O/A only、強制 reason）把
  `paid → invoiced` 且**永不改動 `amount_minor`**（函式內以斷言保護）。
- 逾期由 worker `mark_payments_overdue` 判定：`invoiced` 且 `due_on` 已過
  **org 當地時區**日曆日 → `overdue`，terminal 不動、可重放（idempotent）。

### 2. 設備履歷 = events projection，不建 `asset_events` 專表

- `events_aggregate_type_chk` 加入 `'asset'`（比照 M3/M7 加 customer/conversation/
  intake_draft 的 DROP+ADD 前例），設備服務事件以 hash-chain 的 append-only `events`
  記錄，履歷讀取為 events + 關聯工單摘要的 cursor-merged projection。
- 避免雙寫與二次 source-of-truth。若日後需要結構化查詢（例如以事件型別聚合）再開專表。
- `retire` 為軟刪（`status='retired'` + `deleted_at`），**保留完整履歷**；退役後不可再 append。

### 3. 回訪待辦 = derived，不建 `revisits` 表

- 回訪狀態由 `maintenance_plans.status` + notification `approval_status` +
  `service_requests.origin_*` linkage 推導，不新建 follow-up 表。
- `service_requests.source` 加入 `'revisit'`（**additive enum widen**），並新增
  `origin_maintenance_plan_id`（composite FK 保租戶隔離）與 `origin_service_request_id`，
  讓一鍵轉單帶來源、KPI「回訪率」能一次計數並去重。
- **無自動維修承諾**：回訪提醒經 M6 outbox enqueue 為 `approval_status='pending'` 草稿，
  `claim_notifications` 只挑 `not_required|approved`，因此草稿在 staff 批次核准前不會送出。
  `scan_maintenance_due`（worker）對每個到期 plan 恰 enqueue 一筆（dedupe 於 plan+next_due_on）。

### 4. `original_submission` 放寬為可 redact（scrub → NULL）

- M3 的 `guard_original_submission` 讓 `original_submission` write-once。M8 資料刪除流程
  必須能清除其中的 PII，因此把 guard 放寬為**唯一新增允許**：`value → NULL` 的 redaction；
  `value → 其他 value` 仍拒絕。刪除流程本身以 SECURITY DEFINER（owner `renoly_rls_owner`）
  執行，無法 `ALTER TABLE DISABLE TRIGGER`，故走 guard 放寬而非停用 trigger。

### 5. 資料刪除是 org-scoped 匿名化，保留交易必要 id

- `request_pilot_data_deletion`（owner + re-auth token hash）→
  `finalize_pilot_data_deletion`（confirm-once、org-scoped）匿名化 name/phone/email/address，
  **只動目標 org**，保留 org/customer id、金額與 events 稽核鏈。
- authenticated 限流器 `consume_pilot_authenticated_rate_limit` 比照 public quote 限流器：
  獨立 txn、consume-before-work、keyed on user+org+action（read 300 / mutation 120 /
  search_report 30 每分鐘）。

## 後果

- 收款、履歷、回訪都以既有表 + events 為 source of truth，schema 破壞性變更僅 events
  allowlist 與 source enum 兩處 additive 擴充，低風險、有前例。
- 部分付款與真實金流／總帳留待後續里程碑；UI 以誠實空狀態守住能力落差。
- 若「等待回覆／已略過」等回訪待辦分頁無法乾淨從 derived 狀態推導，再開後續 ADR 加
  `revisits` 表——本輪以 derived 為預設。
