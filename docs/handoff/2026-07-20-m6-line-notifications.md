# 交接文件 — M6 LINE webhook / 通知 outbox / 重試（2026-07-20）

## TL;DR

- M6 交付 LINE-first 通知管線，**全部用 fake adapter 在本機驗證**；真實 `api.line.me` 呼叫是 `RealLineMessenger` 空殼 stub，等你有 LINE OA 憑證時才接上（唯一 deferred 的一步）。
- **git HEAD**：`8eeb087`。前序 M5/M4/M3/seed 修正。branch `feat/v2-pilot-r0-m1-m2`，**未 push**。
- **進度：6/8 完成**（M0–M6 Verified），剩 M7（AI 整理）、M8（收款/回訪/KPI/hardening）。

## 驗證基線（2026-07-20 一手實跑，M6 + review 修復後）

| 指令 | 結果 |
|---|---|
| `npx supabase db reset` | 成功（16 migrations + seed，空庫重建） |
| typecheck / lint | 通過 / 0 errors |
| `npm run test:unit` | 163 檔、**1177** tests |
| `npm run test:sql` | 13 檔、**543** pgTAP（M6 新增 11_（120）+ 12_（15）） |
| `npm run test:integration` | 6 檔、**32** tests（含 M6 fake-adapter 通知全生命週期） |
| `npm run test:coverage` | **exit 0**（四項門檻達標） |
| `npm run build` / `build:local` | 通過 |
| M6 E2E | **2/2**（連接 LINE channel → outbox view，warm server） |

## M6 做了什麼（四道 gate 全用 fake 跑通）

- **收訊 webhook**（`POST /api/v2/webhooks/line/[channelId]`）：讀原始 bytes 驗簽章（timing-safe）、依 event id 去重、快速 200、亂序容忍、原始事件落地。無 domain 寫入、無圖片下載（inline）。
- **發訊 outbox**：M5 那些「未自動發送」stub **已拆除**，改成同交易 enqueue（`202607200005` 重寫 schedule/完工/force-complete/報價送出 RPC）。
- **重試 worker**：claim（`FOR UPDATE SKIP LOCKED`）→ fake 發送 → sent / 退避重試（1/2/5/15/60 分，max 5）/ 達上限 failed；watchdog 回收卡住的 processing。
- **憑證加密**：channel secret/token AES-256-GCM 存 `private.line_channel_credentials`，只回瀏覽器 `credentialConfigured` 布林。
- **kill switch + 手動重送 + UI**：LINE channel 連接表單、outbox 狀態檢視、失敗手動重送。

## review 修復（5 confirmed 全修）

- **HIGH** dedupe_key 加工單 lock_version → reopen 再完工 / reschedule 會重新通知（原本被永久唯一約束靜默丟棄）；`202607200006`。
- **HIGH** 通知 envelope（`{status:"queued",channel}`）與 openapi 對齊。
- **medium** webhook 亂序 watermark：`no_state_change` 忽略事件也推進 `last_event_at`，過時 unfollow 不再錯誤覆蓋較新 follow；`202607200007`。
- **medium** webhook 失敗終態上限（25）+ watchdog，永久失敗不再無限重試。
- **medium** docs 更新。

## 真實 LINE channel 串接（最後一步，deferred seam）

在你提供 LINE OA 憑證前，全流程用 `FakeLineMessenger` 跑通。要接真實 channel 時只需：

1. 填 `src/server/integrations/line/client.ts` 的 `RealLineMessenger.pushMessage` body（呼叫 `https://api.line.me/v2/bot/message/push`，用解密後的 access token）。目前它是 stub（會 throw/TODO）。
2. 設 `.env` 的 `LINE_CHANNEL_*` 與 `LINE_CREDENTIAL_MASTER_KEY_V1`、worker-auth secret（`.env.example` 有佔位）。工廠會依 env 存在自動從 fake 切到 real。
3. 在 LINE Developers Console 設 webhook URL 指向 `/api/v2/webhooks/line/{channelId}`。
4. owner 在設定頁「連接 LINE」貼上 channel id/secret/token（加密存 server）。

## 怎麼在本機模擬測試 M6（給使用者）

dev server（`http://127.0.0.1:3100`）、Alpha seed 帳號可登入（`alpha.owner@example.test` 等，Mailpit 55324 收信）。seed 已含一個 LINE channel（disabled）+ 幾筆 sent/failed 通知供 outbox view。

- **outbox 檢視**：owner 登入 → 設定 → 通知/LINE → 看 sent/failed 清單、手動重送。
- **觸發真實 outbox row**：排程工單或完工工單 → 該動作現在會 enqueue 一筆通知（fake adapter 會「發送」並標 sent）。
- **模擬 inbound webhook**：可用 curl 對 `/api/v2/webhooks/line/{channelId}` 送帶正確 HMAC 簽章的 fixture（測試裡有範例）；驗簽/去重/亂序邏輯會處理。

## 給接手 AI 的踩雷提醒

- 本機一律 `dev:local`/`build:local`/`test:e2e:local`；`.env.local` 指向 production。
- E2E 本機用 `--workers=1`（parallel 會因 dev-server 競用假 fail）。
- 改 gateway/route/schema 後必跑 `test:integration`（真實 RPC + fake adapter，防 mock 漂移）。
- 通知 dedupe_key 帶工單 lock_version——改完工/排程邏輯要確保 lock_version 有 bump，否則重新通知會再被去重丟掉。
- webhook 亂序水位由 `customer_line_identities.last_event_at` 決定，apply 與 no_state_change 都要推進——改 worker 寫入路徑要保持這點。
- `RealLineMessenger` 是**故意的 stub**，不是未完成缺陷；別誤刪或誤判。

## 下一步

- **M7**：LINE 自由訊息聚合 + AI 整理草稿（M6 的 webhook inbox 是基礎；M7 建對話模型 conversations/inbound_messages/intake_drafts）。
- **M8**：收款、設備履歷、回訪、KPI + production hardening。
