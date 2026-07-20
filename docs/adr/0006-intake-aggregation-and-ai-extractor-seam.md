# ADR 0006：LINE 訊息聚合政策與 AI extractor seam（M7）

- 狀態：Accepted
- 日期：2026-07-20

## 背景

M7 要把 LINE 裡的自由文字／圖片訊息，變成不漏掉的「待確認進件草稿」，再由有權限的人員 confirm 成 `service_request`。有兩個必須先定案的設計決策：

1. **聚合窗口**：一個 sender 會連續丟多則訊息（「冷氣不冷」→「在內湖」→「明天下午」→一張照片）。若每則訊息各自成案，inbox 會被同一件事拆成很多張卡片；若永遠聚合，confirm 之後的新訊息又會誤黏到舊案。
2. **AI 供應商耦合**：CLAUDE.md 明定 AI 只能出草稿、人工確認每一步，且策略上要能先對「模擬 LINE 事件 + 假 AI」完整測試，真實 Fireworks 最後才接。若 route／worker 直接呼叫 Fireworks，測試與降級都無法在本機保證。

同時，產品鐵則是：**AI extractor 故障（服務不可用／逾時／壞輸出）絕不能讓客戶的訊息遺失或卡住進件**。這個保證不能只靠應用層 try/catch，必須落在資料層。

## 決策

### 1. 聚合政策：一 conversation 一 open draft，acted-on 前持續聚合

- 以 `conversations` 為 aggregate root，`partial unique (organization_id, line_channel_id, line_user_id) WHERE status='open'` 保證「同一 sender 同時只有一個 open conversation」。
- 連續訊息 `ingest_inbound_message` find-or-create 這個 open conversation 並 append `inbound_messages`；`(organization_id, line_channel_id, line_message_id)` partial unique 去重。
- 一個 conversation 只允許一個 active（`pending_review`）`intake_draft`（`partial unique (organization_id, conversation_id) WHERE status='pending_review'`）；重跑 extraction 就地 update，不 fan-out。
- confirm 或 dismiss 後 conversation 離開 `open`（→ `drafted`／`dismissed`），**之後的新訊息開一個全新的 conversation**。此規則刻意簡單、可測、無時間窗魔法數字。

### 2. AI extractor 是可抽換 seam，真實 Fireworks 為 deferred

- 應用層定義 `AiExtractor` interface，本機／測試用 `FakeAiExtractor`（deterministic、可設定 failure mode），真實 `FireworksAiExtractor` 為 deferred stub（throw），由 `createAiExtractor()` 依 `FIREWORKS_AI_LIVE` env 決定，鏡射 M6 `createLineMessenger()`。LINE image 下載同樣以 `LineContentFetcher` seam 抽換（fake bytes / deferred real）。
- worker 從 conversation 產生草稿並寫 `intake_extraction_runs` 稽核列；`extractor_name in ('fake','fireworks')` 讓稽核可回溯是哪個 extractor。
- 每欄保留 provenance：`intake_drafts.fields` 為 `{ value, source: 'line'|'ai'|'manual', confidence }`，加上整體 `confidence` 與 `origin in ('ai','manual')`，滿足「顯示來源與信心度」gate。

### 3. 降級 gate 落在 DB 層

- `record_extraction_run(status='failed')` 在**同一 transaction** 內：寫一筆 `status='failed'` run（不記 confidence／output），並 upsert 一筆 `origin='manual'` 的 `intake_drafts`（AI 欄位留空、原始訊息完好）。`mark_extraction_failed` 是其薄封裝。
- 因此即使 extractor 全掛，客戶訊息仍以 manual 草稿出現在 inbox，人工可直接處理。此不變量由 pgTAP `13_m7_intake_aggregation.test.sql` 釘住（failed run 後 `intake_drafts` 仍有 `origin='manual'` 列、`inbound_messages.text_content` 完整）。

### 4. confirm 重用 M3，service_requests 不改 schema

- `confirm_intake_draft` 原子地建 `service_request(source='line', source_reference=conversation_id, customer_line_identity_id, original_submission=草稿快照)`、標草稿 `confirmed`＋連結、conversation → `drafted`，並 append `intake_draft.confirmed` 事件。
- **confirm-once** 靠既有 `service_requests (organization_id, source, source_reference)` partial unique：重放回傳同一 service_request，不建第二筆。confirm 之後由 UI 走既有 M3 `triage/convert`。因此 `service_requests` 無需 schema 變更（`source='line'`、`source_reference`、`customer_line_identity_id` 皆已存在）。
- events aggregate allowlist 因此新增 `'conversation'`、`'intake_draft'`（同 M3 新增 `'customer'` 的手法）。

### 5. 角色邊界鏡射 M6

- worker RPC（`ingest_inbound_message`、`attach_message_media`、`record_extraction_run`、`create_intake_draft`、`claim_intake_extraction_runs`、`mark_extraction_*`）為 `SECURITY DEFINER`、owner `renoly_rls_owner`、僅授 `service_role`。
- staff RPC（`confirm_intake_draft`、`dismiss_intake_draft`）僅授 `authenticated`，`owner/admin/dispatcher` gate 在 function 內以 `has_org_role` 檢查。
- 五張表 `FORCE RLS`、`REVOKE ALL`，只授 `authenticated` SELECT（RLS-scoped inbox 讀取）；一切 mutation 經 RPC。

## 替代方案

- **每則訊息一案**：被否決——把同一件事拆成多張卡片，違反「不漏掉」的產品承諾，也讓 confirm 語意模糊。
- **時間窗聚合（例如 5 分鐘）**：被否決——引入魔法數字與時鐘依賴，難以測試；acted-on 邊界（confirm/dismiss）是更清楚、可測的分界。
- **route/worker 直接呼叫 Fireworks**：被否決——無法本機測試、無法保證降級、且會把供應商耦合進核心流程。
- **降級只靠應用層 try/catch**：被否決——若 worker 在 catch 前 crash，訊息就會遺失；把降級寫進 `record_extraction_run` 的單一 transaction 才是硬保證。

## 結果

- 同一 sender 的連續訊息聚合成一 conversation、一 draft；confirm/dismiss 後乾淨分界。
- AI 供應商可在不改核心的前提下抽換；真實 Fireworks 與真實 LINE channel 皆為 deferred，全流程先對 Fake 綠。
- AI 故障不影響進件：訊息永遠以草稿落地，人工確認每一步，符合 CLAUDE.md 鐵則。
- pgTAP `13_m7_intake_aggregation.test.sql` 釘住：租戶隔離、dedup、append-only 不可變、聚合成一 draft、AI-failure-still-drafts、confirm-once、cross-tenant confirm 被拒、RLS/REVOKE/grant 邊界。
