# Renoly v2 安全規格

> 適用：Web、API、Supabase Auth/Postgres/Storage、LINE 整合、背景 worker  
> 原則：deny by default、最小權限、縱深防禦、可稽核、秘密不落 client

## 1. 安全目標

Renoly 處理客戶姓名、電話、地址、設備、施工照片、報價、付款紀錄與 LINE 識別。首要安全目標：

1. 任一組織不得讀寫另一組織資料。
2. 員工只能執行角色與資源關係允許的動作。
3. 客戶公開連結只能查看／回覆單一交易，不可橫向存取。
4. LINE secret、access token、service role、session 永不送到 browser 或 log。
5. 報價、追加、完工與付款異動可追溯，不能靜默竄改。
6. 施工照片預設私有，下載與上傳權限短效且可撤銷。
7. webhook 重送、偽造、亂序或 worker 重跑不產生重複交易。

此文件是工程安全規格，不是法律意見。上線前仍需依實際商業地區、契約及個資處理方式完成法務檢視。

## 2. 資產分類

| 等級 | 資料 | 基準控制 |
|---|---|---|
| Secret | service role、LINE secret/token、encryption master key、worker secret、session/JWT、public capability token | 不進 browser/log/analytics；加密保存；定期 rotation |
| Restricted PII | 姓名、電話、email、地址、LINE user id、現場照片、簽認資訊 | tenant/RBAC、private storage、最小 DTO、retention/deletion |
| Confidential | 成本、margin、報價、請款、內部備註、技師排程 | RBAC + field-level DTO + audit |
| Internal | 組織設定、事件 metadata、服務目錄 | authenticated tenant access |
| Public | 店家公開名稱、公開表單欄位、對客報價售價與條款 | token scope；仍防篡改與濫用 |

Secret 不得存於 `NEXT_PUBLIC_*`。只有 Supabase URL、anon key、LIFF public id 可為 public config；anon key 不是授權機制，所有 domain table 仍需 RLS。

## 3. Trust boundaries 與威脅

```text
Untrusted browser / LIFF
  │ HTTPS, session/token, validation
  ▼
Next.js API boundary
  │ user JWT 或 narrow service operation
  ▼
Postgres RLS / private Storage

LINE provider ── signed raw webhook ──> inbox
worker ── private credentials ──> LINE API
```

主要威脅與控制：

| 威脅 | 控制 |
|---|---|
| 猜 UUID／竄改 org id 越權 | path org + membership + resource org 檢查；RLS；composite FK；跨租戶一律 404 |
| technician 竄改別人工單 | assignment-scoped RLS；transition RPC 驗 actor；禁止 generic status PATCH |
| service role 外洩／誤用 | server-only module；環境分離；不可 import 到 client；worker 最小 query；rotation |
| CSRF | SameSite cookie + synchronizer CSRF token + Origin/Host 驗證 |
| XSS 偷取資料 | React escaping、禁止未清理 HTML、嚴格 CSP、HttpOnly session、輸入／輸出編碼 |
| SQL injection | Supabase query builder／parameterized SQL；RPC 禁 dynamic SQL；輸入 allowlist |
| 偽造 LINE webhook | raw body HMAC-SHA256、constant-time compare、destination matching、大小限制 |
| webhook／action replay | provider event unique key、Idempotency-Key、state machine、outbox dedupe |
| 公開 token 暴力猜測／外洩 | 256-bit 不可猜 capability（CSPRNG／server-key HMAC）、只存 hash、到期／撤銷／scope、rate limit、no-referrer、log redaction |
| 惡意檔案／圖片炸彈 | signed upload、size/type/magic-byte/dimension 驗證、quarantine、重編碼、私有 bucket |
| SSRF | 不接受任意遠端 URL；LINE content 只用固定官方 endpoint 與 server-side message id |
| 敏感 log／analytics 外洩 | structured allowlist log、redaction、禁錄 raw body/signed URL/PII |
| AI 錯價／錯誤承諾 | AI output 永遠是 draft；人工核准才可 send/transition |

## 4. Authentication 與 session

### 4.1 員工登入

- v2 MVP 使用 Supabase Auth email OTP／magic link。
- 不自行簽發可被 Postgres 接受的 JWT；不信任 client 傳入的 `userId`、email、role。
- server 每次 request 以 Supabase 驗證 session，授權主體取 `auth.uid()`。
- 新使用者必須經 organization invite 或建立自己的 organization；登入成功不等於有任何租戶權限。
- owner/admin 修改 email、重設登入因子或敏感設定時要求最近 15 分鐘內重新驗證。
- production owner 建議強制 MFA；正式開放多店管理前列為必做。

若未來支援 LIFF 員工登入：server 必須向 LINE 驗證 ID token 的 issuer、audience、expiry、nonce，再交換為第一方 Supabase session；`line_user_id` 本身不是 credential。

### 4.2 Cookie

Session cookie：

```text
HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age 依 Supabase session policy
```

- production 禁止 HTTP。
- 不將 access/refresh token寫入 `localStorage`、URL、React state persistence 或 analytics。
- 登出需 server 端撤銷 refresh session 並清 cookie，不只清 UI state。
- 權限／membership 被 suspended/removed 後，下個 API request 立即失效；不可只依 JWT 裡的舊 role claim。
- 異常登入、密碼／OTP 猜測依 user + IP rate limit；登入錯誤不得揭露 email 是否存在。

### 4.3 CSRF

所有 cookie-authenticated `POST/PUT/PATCH/DELETE`：

1. 驗證 `Origin` 精確等於 configured app origin；無 Origin 時驗 `Host`/`Sec-Fetch-Site`。
2. 驗證 server-issued synchronizer token `X-CSRF-Token`，與 session 綁定，constant-time compare。
3. Content-Type 必須是 `application/json`（signed Storage PUT 例外）。
4. 失敗回 403 `CSRF_INVALID`，不進 domain service。

LINE webhook、public token API 不用 session CSRF，但仍有 signature／capability token、Origin-independent rate limit 與 idempotency。

## 5. Authorization

### 5.1 三層授權

每次 domain 操作必須同時通過：

1. **API 層**：active membership + role + resource relationship + state。
2. **資料庫層**：RLS 以 `auth.uid()`、`organization_id`、assignment 驗證。
3. **關聯層**：composite FK `(organization_id, parent_id)` 阻止跨租戶關聯。

任何一層失敗都不可用 service role「繞過來讓功能可用」。跨組織／不存在回 404；同組織但角色不足回 403。

### 5.2 Canonical roles

| Role | 定位 |
|---|---|
| owner | 帳號、成員、LINE、所有營運與敏感更正；組織至少一名 |
| admin | 除移除／降級最後 owner 外的管理權 |
| dispatcher | 客戶、需求、報價、排程、工單、回訪日常營運 |
| technician | 只存取被指派工單的必要資料；現場狀態、檢查、照片 |
| accountant | 報價成本、追加、請款、收款；無 LINE credentials／門禁備註 |
| viewer | 組織營運唯讀；不含成本、internal notes、秘密 |

### 5.3 權限矩陣

`R` read、`W` create/update、`X` sensitive action、`A*` assigned only、`—` deny。

| Resource / action | owner | admin | dispatcher | technician | accountant | viewer |
|---|---:|---:|---:|---:|---:|---:|
| Organization basic | RWX | RW | R | R | R | R |
| Memberships | RWX | RW* | R | R basic | R basic | R basic |
| LINE channel / token rotation | RWX | RWX | — | — | — | — |
| Customers / locations / assets | RW | RW | RW | R A* | R limited | R limited |
| Service requests | RWX | RWX | RWX | R A* | R limited | R |
| Projects | RWX | RWX | RWX | R A* | R financial | R |
| Work orders / schedule | RWX | RWX | RWX | RW A* | R summary | R |
| Assignment management | RWX | RWX | RWX | respond self | — | R |
| Checklist / photos | RWX | RWX | RWX | RW A* | R evidence | R |
| Service catalog | RW | RW | RW | R no cost | R cost | R no cost |
| Quote / cost / send | RWX | RWX | RW draft / cost | R A* no cost | R cost | R no cost |
| Change order | RWX | RWX | RWX | R A* no internal | R financial | R |
| Payment milestone | RWX | RWX | R | — | RWX | R |
| Maintenance / reminders | RWX | RWX | RWX | R A* | R | R |
| Notification retry / cancel | RWX | RWX | RWX | R A* status only | — | — |
| Audit events | R | R | R operational | R A* | R financial | R redacted |
| Payment reversal / reopen completed | X | X (依規則) | — | — | — | — |

`admin RW*` 不得更動 owner membership，除非操作者也是 owner。viewer 預設不看成本、內部備註、門禁資訊或完整聯絡資料；若產品未實作 field redaction，就先拒絕該 endpoint，而不是多回資料。

### 5.4 Technician scope

技師可存取工單的條件：

- active membership；且
- 存在該 work order 的 assignment，status 在 `assigned/accepted/checked_in/completed`；且
- 工單未被取消超過 retention window。

可讀：工單內容、服務地址、現場聯絡方式、必要 access notes、該設備、檢查表、照片、自己的 assignment。不可讀：客戶其他地址、全客戶歷史、成本/margin、其他技師電話、LINE identity、internal financial notes。

技師不可 direct PATCH `work_orders.status`；只能呼叫 transition RPC。完成後 30 日可讀該工單供保固紀錄，之後預設只讀摘要，除非再次被指派。

### 5.5 Field-level authorization

RLS 保護 row，不保護 column。下列必須使用明確 DTO mapper 或 security-invoker view：

- quote/service catalog 的 `unit_cost_minor`、margin/internal notes
- location 的 `access_notes`
- customer 完整電話/email
- LINE credential metadata
- notification destination/provider error

Public DTO 必須獨立建立 allowlist mapper；禁止先序列化 internal DTO 再 delete 敏感欄位。

## 6. Database 與 Supabase

### 6.1 Client 分離

建立兩個不能互換的 server module：

- `createUserSupabaseClient(request)`：帶使用者 session/JWT，受 RLS；一般 API 使用。
- `createAdminSupabaseClient()`：service role，僅 webhook／public capability gateway、outbox／maintenance worker、credential rotation，以及「已由 authenticated RPC 授權後」的 private Storage 短效 URL 簽發使用；一般 domain table 讀寫禁止使用。

`createAdminSupabaseClient` 模組必須有 `server-only` guard，禁止被 client component import。Route handler 不得因 RLS error 改用 admin client retry。Storage signer 只能接收 authenticated RPC 回傳的 allowlisted photo metadata，不得自行以 service role 查 `photos` 或其他 domain table。

### 6.2 RLS 與 grants

- 所有 public tenant table `ENABLE` 且 `FORCE ROW LEVEL SECURITY`。
- `anon` 不得直接 SELECT/INSERT/UPDATE/DELETE domain table。
- `authenticated` 僅得到 RLS policy 需要的 table privileges。
- `private` schema對 `anon/authenticated/public` 全 REVOKE。
- `events`、attempt logs 對 authenticated 禁 UPDATE/DELETE。
- `SECURITY DEFINER` function：owner 為 non-login role、固定 search_path、參數化、無 dynamic SQL、revoke public execute、內部再次驗 `auth.uid()`／role。
- migration CI 必須檢查新 table 是否遺漏 RLS、FK index、composite tenant FK。

### 6.3 Service role

- 只存在 Vercel production/staging server secret store，環境各自不同。
- 不出現在 `.env.example` 的真值、error tracking context、build output、source map 或任何 response。
- 每 90 日及任何疑似洩漏後 rotation；rotation runbook 必須先部署可接受新舊 key 的切換順序。
- worker 使用 service role 時，每個 query 仍明確帶已從可信 row 得到的 organization id；不得信任 HTTP body 的 org id。

### 6.4 SQL 安全

- 只用 Supabase query builder、prepared statement 或固定 SQL RPC。
- sort column、filter operator、resource type 都用 allowlist mapping；不可把 query string插入 SQL identifier。
- statement timeout：互動查詢建議 5 秒，worker 30 秒；idle-in-transaction 30 秒。
- transaction 內鎖定順序固定 aggregate → children → event/outbox，降低 deadlock。

## 7. Input validation 與輸出安全

### 7.1 API validation

- 所有 params/query/body 用 Zod `.strict()`，在 application service 前驗證。
- string 先 normalize Unicode、trim；保留業務必要換行，但設定長度上限。
- phone/email/date/time/currency/status/role 皆 allowlist 或精確 schema。
- monetary string 轉 DB numeric 前驗證 regex、safe business range與小數位；禁止 `NaN/Infinity/exponent`。
- JSON metadata 最大 16–32 KB、nest depth <= 5、key count <= 100；禁止原型污染 key `__proto__/constructor/prototype`。
- array 設上限：quote items 300、bulk catalog 200、assignments 20、照片一次 20、通知批次 100。
- server 永遠重新計算 totals、status timestamp、document number、organization id、actor id。

### 7.2 XSS

- 一般文字以 React text node render，不使用 `dangerouslySetInnerHTML`。
- 若未來支援 rich text，server + client 以 allowlist sanitizer；禁止 script、style、iframe、event handler、javascript/data URL。
- PDF renderer 同樣只吃純文字 DTO；限制長度，避免 template injection／資源耗盡。
- filename、caption、客戶輸入不得直接插入 response headers；下載檔名使用 RFC 5987 安全編碼與 server 產生 fallback。

### 7.3 Error handling

- client 只收到 API spec 的 problem details 與穩定 error code。
- server log 用 internal error id 關聯 stack；不回 DB error、table name、provider body。
- auth/token/public link error 使用一致訊息與近似處理時間，降低 account/token enumeration。

## 8. Secrets 與加密

### 8.1 必要環境秘密

至少：

```text
SUPABASE_SERVICE_ROLE_KEY
LINE_CREDENTIAL_MASTER_KEY_V1
PUBLIC_TOKEN_PEPPER
CURSOR_SIGNING_KEY
WORKER_SECRET
CSRF_SECRET
```

程式啟動時驗證存在、長度與格式；缺少直接 fail closed。不得提供 production default。
`PUBLIC_TOKEN_PEPPER` 以不同 domain prefix 分別用於低熵 IP keyed hash 與 quote capability HMAC；不可送到 client、log 或 analytics。

### 8.2 LINE credential encryption

- `channelSecret`、`channelAccessToken` 收到後立即以 AES-256-GCM envelope encryption。
- 每筆使用隨機 96-bit nonce；AAD 至少包含 `organization_id`, `line_channel_id`, `credential_type`, `key_version`。
- DB 存 ciphertext、nonce、key version；master key 僅在 deployment secret store。
- API response 只回 `credentialConfigured: true`、version、rotatedAt；不回 masked value。
- 解密只在 webhook signature verifier／LINE sender 的最小函式內，使用後釋放 reference，不記 log。
- 支援 `V1/V2` key ring：先部署可讀兩版、以新版寫入、批次 re-encrypt、確認後移除舊 key。

### 8.3 Public token

- intake capability 使用 CSPRNG 32 bytes；quote capability 以 server-only key 對 `operation + organization + quote + Idempotency-Key` 做 domain-separated HMAC-SHA256。兩者都是 256-bit base64url without padding；quote mutation replay 會得到完全相同且不可猜的 URL。
- DB 只存 `SHA-256(token)`。quote 明文只存在 API response、URL fragment 與 browser 當次 Authorization header；不落 DB。
- 每個 token 具 resource、scopes、expiresAt、maxUses、revokedAt。
- quote/change order token 預設 30 日或交易 validUntil 較早者；intake form 可長期但可隨時 rotate。
- URL 頁面設 `Referrer-Policy: no-referrer`，不載入第三方 script／analytics／外部圖片。
- quote capability 放在 `/public/quotes#<capability>` fragment，API 使用固定 `/public/quotes/current` path + bearer header；HTTP request path、Problem Details 與 access log 不含 raw token。Authorization header 必須由平台／log drain 保持 redacted。

M4 Pilot 的 quote token 只綁定單一 immutable version 與 `quote:read/quote:respond` scope，最長 30 日且不超過報價效期；owner／admin rotate 時會先撤銷同一 quote 的舊 token。staff route 只把 hash 交給 RPC，public route 只把 hash 交給 service-role gateway，staff browser 永遠拿不到 service-role key。原始 URL 遺失後不能從資料庫讀回，只能 rotate；相同 mutation idempotency key 的網路 retry 則可安全重建完全相同 URL。

## 9. LINE webhook 與訊息安全

### 9.1 驗簽

1. 在任何 JSON parse 前取得 raw bytes；body 上限 1 MB。
2. 依 URL `lineChannelId` 從 private credential store 取 secret；URL 本身不代表授權。
3. 計算 `base64(HMAC-SHA256(secret, rawBody))`。
4. 長度一致後使用 constant-time compare `X-Line-Signature`。
5. 驗證 payload destination 符合 channel metadata。
6. 簽章失敗回 401，不落 raw payload、不處理事件；只記 channel id、request id、來源網段摘要與計數。

### 9.2 Inbox 與 replay

- 以 `(line_channel_id, webhook_event_id)` unique；duplicate 仍回 200。
- provider 事件可能亂序，handler 依 event timestamp + domain current state 決定 apply/ignore，不假設到達順序。
- webhook request 只 insert inbox，p95 目標 < 500 ms；圖片下載與 domain write 由 worker。
- reply token 短效且只能使用一次；若 worker 來不及則改用 push，且 outbox dedupe。
- LINE user id 只在同一 channel scope 唯一，禁止跨 OA 自動合併。
- 原始 webhook payload 預設 90 日後刪除；必要欄位轉成 domain event 後不永久保存 raw body。

### 9.3 Outbound

- 只使用 allowlisted Flex/message template；user text 只放 text field，不拼接 JSON string。
- 交易通知與回訪通知分開；回訪需 consent／合法業務規則與退訂機制。
- `notification.dedupe_key` 防止重複；429/5xx/timeout 指數退避，4xx 永久錯誤不盲目重試。
- provider response log 只留 status/request id/error code，不留 recipient、access token 或完整 message body。

## 10. Private media

### 10.1 上傳規則

MVP allowlist：`image/jpeg`, `image/png`, `image/webp`。HEIC 在 server pipeline 完成可靠解碼前拒絕，不以副檔名判斷。

- 單檔原始上限 10 MB；解碼後最大 25 megapixels、最長邊 10,000 px。
- API 先驗證 parent 權限、宣告 size/type，建立 pending row 與 10 分鐘 signed PUT URL。
- Storage path 完全由 server 產生，含 org/parent/photo UUID；不接受 client path。
- complete 時重新讀 object metadata、sniff magic bytes、比對 byte size/hash；不信任 browser `Content-Type`。
- 檔案先 `quarantined/processing`；成功解碼、重編碼為 WebP/JPEG、移除 EXIF/GPS、產縮圖後才 `ready`。
- 解碼失敗、polyglot、超大像素或 hash 不符標 `quarantined/failed`，不可簽 read URL。
- 若未部署 malware scanner，所有非圖片格式均拒絕；未來 PDF 上傳需獨立 quarantine/scanning pipeline。

### 10.2 下載規則

- bucket 永遠 private；禁止 public URL。
- API 每次驗 parent resource 權限後簽 read URL，縮圖 5 分鐘、原圖 1 分鐘。
- signed URL 不存 DB、不記 log、不送第三方 analytics。
- public quote/change order 預設不含現場照片；若明確分享，token scope 必須列出 photo ids，不可讓 token list parent 全部媒體。
- response header：`Content-Disposition: inline`、正確 sniffed content type、`X-Content-Type-Options: nosniff`。

### 10.3 刪除

- UI delete 先 soft delete + revoke access；worker 在 30 日 grace 後刪原圖與縮圖。
- 組織停用不立即刪資料；owner 匯出／刪除流程需重新驗證與雙重確認。
- failed/pending orphan 每日清除；object 與 DB row cleanup 必須可重入。

## 11. Public customer flows

- Token scope 最小化：`quote:read/quote:respond`、`change_order:read/respond`、`intake:create/upload`、`work_order:signoff`。
- GET view 可匿名但 rate limited；respond 必須 Idempotency-Key，並鎖 active version。
- 接受／拒絕時至少記錄：resource/version、token id（非明文）、display name、timestamp、comment 與 decision event。IP keyed hash、user-agent family 是 production hardening gate，M4 Pilot 尚未送入 quote decision RPC。
- 不把一般點擊宣稱為法定電子簽章；產品文案使用「簽認紀錄」。若客戶需要更高保證，另導入 OTP／第三方簽署。
- 有效 token 指向 superseded version 時只顯示「已有新版，請重新開啟」，不可接受舊版。
- Public response 不回內部 UUID、成本、internal notes、其他案件或員工資訊。
- 防濫用：IP + token sliding window、honeypot、行為門檻 CAPTCHA、相同電話／LINE identity 建單頻率限制。

公開 intake 與 M4 quote 都已有 PostgreSQL 共享時窗限制。quote gateway 先以獨立 transaction 消耗 private IP/token budget，成功後才進入會鎖 quote row 的 view/respond RPC；因此後續 404/409/429 不會回滾計數。view 為 120/IP + 60/token/10 分鐘，respond 為 10/IP + 5/token/小時，超限固定回 429。

## 12. Rate limiting

Production 使用共享儲存（例如 Redis/KV/Postgres advisory scheme），不可用單 instance memory limiter。key 結合 user、organization、IP hash、public token id；反向代理 IP 只信任 Vercel 指定 header。

| Endpoint 類型 | 初始限制 | 超限 |
|---|---:|---|
| 一般 authenticated read | 300/user/5 min | 429，Retry-After |
| 一般 mutation | 120/user/5 min | 429 |
| 搜尋／report | 30/user/min | 429 |
| Login/OTP request | 5/email + 20/IP/hour | generic response |
| Public view | 120/IP + 60/token/10 min | 429 |
| Public intake create | 10/IP + 5/token/hour | 429/CAPTCHA |
| Public respond | 10/IP + 5/token/hour | 429 |
| Photo upload init | 30/user/hour；public 10/IP/hour | 429 |
| LINE webhook | 600/channel/min，另 1 MB body | 429 僅明顯攻擊；合法 provider burst 要監控 |
| Worker endpoint | 60/deployment/min | 429 + alert |

限制值需以真實流量調整；任何調高都要保留 body size、batch size 與 query window 上限。

## 13. HTTP 與瀏覽器防護

Production headers：

```text
Strict-Transport-Security: max-age=31536000; includeSubDomains
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(self), geolocation=(self), microphone=()
X-Frame-Options: DENY
Cross-Origin-Opener-Policy: same-origin
```

Public token pages改 `Referrer-Policy: no-referrer`。若 LIFF 需要特定 framing，僅在 LIFF route 以 CSP `frame-ancestors` 精確 allowlist LINE origin，不全站放寬。

CSP 初始基準（依 Next.js nonce 實作調整）：

```text
default-src 'self';
base-uri 'none';
object-src 'none';
frame-ancestors 'none';
form-action 'self';
script-src 'self' 'nonce-{per-request}' https://static.line-scdn.net;
style-src 'self' 'unsafe-inline';
img-src 'self' blob: data: https://*.supabase.co https://profile.line-scdn.net;
connect-src 'self' https://*.supabase.co https://api.line.me;
font-src 'self';
upgrade-insecure-requests;
```

- 不使用 `script-src 'unsafe-eval'`；逐步移除 inline style 後收緊 `style-src`。
- CORS 預設 same-origin，不設 `*`；如需獨立前端，精確 allowlist origin，credential response 不可 wildcard。
- API state-changing method拒絕 browser simple form content types。
- 不把 token／PII 放 URL query 或 path；quote capability 只放 fragment，再轉為 redacted Authorization bearer。其他 public capability 若仍使用 path，必須先具備平台 access-log redaction 與 no-referrer。

## 14. Logging、監控與 audit

### 14.1 Allowlist logging

可記：request id、route template、method、status、duration、user id、organization id、resource id、domain error code、provider status/request id。

不可記：

- Authorization/Cookie/CSRF、session/JWT
- LINE secret/access token/signature/raw webhook body/reply token
- public token、signed Storage URL
- 完整姓名、電話、email、地址、notes、photo metadata EXIF
- quote item raw body、付款外部 reference 全值

logger 在輸出前遞迴 redact key allowlist；不是只靠 key 名 blacklist。production 禁用 request-body logging 與 session replay；error tracker user context 只用 opaque user/org id。

### 14.2 Audit events

必記：membership/role、LINE credential、報價 send/respond/cancel、change order、work order transition/reopen、payment paid/reverse、public token create/revoke、PII export/delete、security policy override。

Event append-only；payload 記 before/after 的必要狀態、reason、actor、request id，不記 secret/完整 PII。每日備份／hash chain 可用來發現竄改，但不得宣稱不可否認性。

### 14.3 Alerts

- 同 channel 連續簽章失敗 20 次
- service role／credential decrypt error
- RLS denial 或 cross-tenant authorization denial異常上升
- public token 404/429 burst
- outbox 最老 pending > 5 分鐘、永久失敗率 > 5%
- quarantine upload > baseline、單 org 儲存量突增
- owner role／credential rotation／大量匯出

## 15. 個資生命週期

以下是產品預設，不替代客戶所在地法規／契約：

| 資料 | 預設 |
|---|---|
| raw LINE webhook payload | 90 日後刪除 |
| notification attempts | 1 年後彙總／刪除 provider 細節 |
|一般 idempotency response | 24 小時；不可逆交易 30 日 |
| application/security logs | 30–90 日，依環境與需求 |
| pending/failed media | 24 小時／7 日 cleanup |
| soft-deleted media | 30 日後 object delete |
| 客戶營運資料 | 組織 policy；刪除要求後先停用，再依交易保存需求匿名化 |
| 財務／簽認 audit | 由店家設定並經法務確認；不可因一般客戶刪除而破壞必要交易證據 |

實作資料匯出／刪除：owner 重新驗證、非同步產檔、私有 signed download 15 分鐘、完成／下載事件、24 小時後刪 export。刪除時保留交易必要 id，但將非必要姓名、電話、email、地址替換為匿名值；備份中的資料依備份 lifecycle自然到期且不可回復至 active production。

行銷回訪與交易通知分開記 consent。客戶退訂後仍可收必要交易通知，但不可再收保養行銷；每則回訪需可辨識店家與退訂方式。

## 16. Payment 安全邊界

v2 `payment_milestones` 只是應收／已收紀錄：

- 不接受或儲存完整卡號、CVV、網銀密碼、銀行登入資料。
- `externalReference` 只存低敏感對帳識別，長度 120；UI 警示不要貼帳密。
- mark paid 與 reverse 是高風險 audit action；前者 accountant/owner/admin，reverse 限 owner/admin、需 reason、ETag、Idempotency-Key。
- 未來導入金流必須使用 provider hosted checkout／tokenization，另做 threat model、webhook 驗簽與 reconciliation；不可直接擴充目前欄位存卡資料。

## 17. Dependency、CI/CD 與供應鏈

- commit lockfile；CI 使用 `npm ci`。
- PR 執行 lint、typecheck、unit/integration/E2E、migration reset、RLS test、secret scan、dependency audit。
- High/Critical runtime vulnerability 阻擋 release；若無修補需有書面風險接受與期限。
- GitHub/Vercel/Supabase production 權限最小化、強制 MFA；離職立即撤銷。
- preview deployment 不注入 production secrets，不連 production DB/LINE channel。
- 不允許 migration 從不受信任 fork 自動對 production 執行。
- Source map 僅上傳受控 error tracker，不公開 server source map。
- `NEXT_PUBLIC_` build-time scan 阻止 secret-like variables。

## 18. 安全測試

### 18.1 必要自動測試

RLS／授權：

- 六種角色對每個 table／RPC 的 allow/deny matrix。
- Org A 每種資源 id 套入 Org B session，GET/UPDATE/DELETE/RPC 全部拒絕。
- technician 未指派／已指派／取消／完工超 retention 各案例。
- 最後 owner 不可降級、suspend、remove。
- service role 不出現在 client bundle（build artifact scan）。

API：

- 無 auth、過期 session、無 CSRF、錯 Origin。
- Zod unknown keys、超長字串、巨大 array、invalid numeric、prototype pollution keys。
- 缺 If-Match、stale ETag、並行 accept、並行 schedule。
- Idempotency 同 body replay、不同 body conflict、processing timeout recovery。
- error snapshot 不含 SQL/stack/secret/其他租戶 id。

LINE：

- 官方格式的有效 signature、body 改一 byte、錯 secret、缺 header、超大 body。
- duplicate event、亂序 event、同 event 並行送達、reply token 失效、429/5xx retry。
- credential rotation 新舊 key 過渡與 ciphertext 無法解密時 fail closed。

Public token：

- random invalid、expired、revoked、wrong scope、max uses、superseded quote。
- token 不出現在 log/Referer/analytics；brute force 觸發 rate limit。
- 並行 accept 只有一筆成功且 event/outbox 一次。

Media：

- 假副檔名、錯 MIME、truncated JPEG、polyglot、超大小／像素、hash mismatch、EXIF GPS 移除。
- signed URL 過期、其他 org path、未 ready object、soft deleted object。
- upload init 後未完成的 orphan cleanup。

### 18.2 手動／定期測試

- 上線前 security checklist 與 Supabase Security Advisor。
- 每季 dependency／權限／secret rotation review。
- 重大 auth、public link、LINE、upload、payment 變更後做 focused penetration test。
- 每年至少一次 restore drill 與 incident tabletop。

## 19. 備份與災難復原

- 啟用 Supabase production backup/PITR（依方案）；備份同等視為 Restricted。
- Storage object lifecycle 與 DB backup 分開驗證；只備 DB metadata 不代表照片可復原。
- RPO/RTO 初始目標：RPO 24 小時、RTO 8 小時；有付費關鍵客戶後升級至 RPO 1 小時、RTO 4 小時。
- 每季在隔離環境 restore，驗證 table row count、RLS/grants、抽樣媒體 hash；不得把 restore 環境接 production LINE。
- encryption master key需獨立安全備份；沒有 key 的 ciphertext backup 等同不可復原。

## 20. Incident response

1. **Detect/triage**：建立 incident id，分級，保存 request/event/log 證據。
2. **Contain**：撤銷 public token/session、disable LINE channel、rotate service/provider key、暫停 worker；避免直接刪證據。
3. **Assess**：確認受影響組織、資料類型、時間範圍與是否有跨租戶讀取。
4. **Eradicate/recover**：修補、加 regression test、從可信版本 deploy、監控異常。
5. **Notify**：由負責人依契約與適用法規決定客戶／主管機關通知，不由工程師臨場猜測。
6. **Postmortem**：五個工作日內完成 root cause、timeline、控制缺口、owner/due date。

常用緊急開關：停用特定 organization、撤銷特定 public token、disable channel outbound、暫停 public intake/upload、暫停 notification worker。開關本身只能 owner/system operator 使用並產 audit event。

## 21. Production release gate

- [ ] 所有 tenant table FORCE RLS，cross-tenant test 全綠。
- [ ] anon 無 domain table access；private schema grants 經驗證。
- [ ] client bundle／source map／logs 無 service role、LINE/token/master key。
- [ ] Session cookie、CSRF、Origin、CORS、CSP 與 security headers 已驗證。
- [ ] API request/response strict schema；errors 無內部資訊。
- [ ] Public tokens 256-bit、hash-only、到期／撤銷／scope／rate limit 正常。
- [ ] LINE raw body signature、event dedupe、outbox retry 經整合測試。
- [ ] Storage private、signed URL 短效、magic-byte/dimension/EXIF pipeline 完整。
- [ ] Quote/change order/work order/payment 的狀態機、ETag、idempotency、audit event完整。
- [ ] Backup + restore drill 成功，staging/production secret/LINE channel 完全分離。
- [ ] 監控、告警、credential rotation 與 incident runbook 有明確 owner。
