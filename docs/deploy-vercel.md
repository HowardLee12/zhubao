# Vercel 部署指南（Renoly v2 pilot）

本機的 Supabase 與 fake adapter 只在開發時運作。要在 Vercel 正常跑，需要 **(1) production Supabase、(2) 環境變數、(3) Supabase Auth 設定、(4) cron 排程**。真實 LINE / Fireworks 是後續才接的 deferred seam。

## 1. Production Supabase

1. 在 supabase.com 建一個 production 專案。
2. 套用所有 migration（本機 CLI）：
   ```bash
   supabase link --project-ref <你的-project-ref>
   supabase db push          # 套用 supabase/migrations/ 全部
   ```
   > seed.sql 是測試資料，**不要**推到 production（`db push` 只套 migrations，不套 seed，正確）。
3. Dashboard → Settings → API 取得 `URL`、`anon key`、`service_role key`（填進下方環境變數）。

## 2. Vercel 環境變數

Project → Settings → Environment Variables（Production scope）。

### 必填

| 變數 | 來源 / 值 |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | production Supabase URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | production anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | production service_role key（server-only；勿加 NEXT_PUBLIC） |
| `NEXT_PUBLIC_APP_URL` | 你的正式網址，**必須 https**（例 `https://renoly.vercel.app`）；production 缺此值會讓 CSRF 500 |
| `AUTH_SECRET` | 隨機 ≥32 字元 |
| `PUBLIC_TOKEN_PEPPER` | 隨機 ≥32 bytes |
| `WORKER_SECRET` | 隨機 ≥32 bytes（內部 worker 認證） |
| `CRON_SECRET` | 隨機（Vercel Cron 觸發 `/api/cron/daily` 用；Vercel 會自動把它注入 cron 請求的 Authorization bearer） |
| `LINE_CREDENTIAL_MASTER_KEY_V1` | **32-byte 金鑰的 base64**（加密店家 LINE 憑證用；即使還沒接真實 LINE 也先設好，之後才不用回填重加密） |

> 隨機值產生：`openssl rand -base64 32`（master key 必須正好解碼成 32 bytes，用 `-base64 32`）。

### 現在可留空（deferred seam，之後接真實服務再填）

| 變數 | 何時填 |
|---|---|
| `LINE_CHANNEL_LIVE` | 接真實 LINE 時設 `1` |
| `FIREWORKS_AI_LIVE` | 接真實 AI 時設 `1` |
| `FIREWORKS_API_KEY` | 同上，填 Fireworks key |
| `LINE_CREDENTIAL_MASTER_KEY_V2` | 只有金鑰輪替才需要 |
| `PUBLIC_TRUSTED_PROXY_COUNT` | 除非前面串了額外反向代理，否則留空（預設 0） |

### 不需要（v1 遺留，R0 已隔離成 404）

`ECPAY_*`、`THREADS_*`、`NEXT_PUBLIC_LIFF_ID`、`NEXT_PUBLIC_FEEDBACK_SHEET_URL`、`PILOT_MAIL_SERVER_URL`、`PLAYWRIGHT_BASE_URL`。

## 3. Supabase Auth（magic-link 登入）

1. **SMTP**：Dashboard → Authentication → Email → 設定自己的 SMTP（production 寄信）。內建寄信有低量限制，pilot 前建議接自己的（SendGrid/Resend/SES 等）。
2. **URL Configuration**：
   - Site URL = `https://<你的-vercel-域名>`
   - Redirect URLs 加入 `https://<你的-vercel-域名>/auth/callback`
   - 缺這步 → 登入連結會導到錯誤 host（本機開發時遇過的 host 一致性問題的 production 版）。

## 4. Cron / 背景 worker

`vercel.json` 已設一個每日 cron（`0 1 * * *` = 每天 01:00 UTC）打 `/api/cron/daily`，該 route 用 `CRON_SECRET` 驗證 Vercel、再帶 `WORKER_SECRET` 依序跑全部 worker（webhook 處理、AI 抽取、通知發送、逾期標記、回訪掃描、資料清理）。

**Hobby plan 限制**：cron 一天最多一次、最多 2 個。所以：
- M8 每日任務（逾期/回訪/清理）→ 每日一次，正常。
- M6 LINE 通知與 inbound webhook → **會延遲到每日一次，不即時**。

**要讓通知即時**（升 Pro 後）：在 `vercel.json` 把 `notification-dispatch` 與 `webhook-process` 拆成獨立 cron、schedule 改 `* * * * *`（每分鐘）；或用外部排程（GitHub Actions / cron-job.org）每分鐘 POST 這兩個 worker route（帶 `Authorization: Bearer <WORKER_SECRET>`）。細節見 `src/app/api/cron/daily/route.ts` 註解。

## 5. 接真實 LINE / Fireworks（deferred，之後做）

1. **LINE**：填 `RealLineMessenger.pushMessage` + `RealLineContentFetcher` body，設 `LINE_CHANNEL_LIVE=1`；LINE Developers Console 的 webhook URL 指向 `https://<域名>/api/v2/webhooks/line/{channelId}`；owner 在設定頁「連接 LINE」貼 channel 憑證（加密存 server）。
2. **Fireworks**：填 `FireworksAiExtractor.extractIntake` body，設 `FIREWORKS_AI_LIVE=1` + `FIREWORKS_API_KEY`。

## 6. ⚠️ 部署即生效的產品切換

部署後 **R0 讓線上 v1 的所有 API 與 v1 頁面變 404**（ECPay 回調、Threads、舊報價分享頁等）。這是刻意的 v1→v2 切換，確認你不再依賴 v1 對外服務後再上線。
