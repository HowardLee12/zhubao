# M4 本機人工驗收手冊

本手冊驗收的是真實 local Supabase 流程，不是 `/demo` fixture。完成後應能從空白測試帳號走完：

`免註冊進件 → 店內分流 → 正式報價草稿 → owner 核准 → 客戶免註冊接受／拒絕 → 接受後轉工單`

## 1. 啟動乾淨環境

需求：Node.js 20+、Docker、Supabase CLI。只在 repository 根目錄執行：

```bash
npm install
npx supabase start
npx supabase db reset --local
npm run dev:local
```

`db reset --local` 會刪除並重建**本機**資料；不要對遠端專案執行 reset。成功後使用：

- 員工 App：<http://127.0.0.1:3100/login>
- 本機登入信箱：<http://127.0.0.1:55324>
- Supabase Studio：<http://127.0.0.1:55323>

本機請使用 `dev:local`，不要直接執行 `npm run dev`；repository 的舊 `.env.local` 可能仍指向 v1 遠端環境。

## 2. 建立 owner 與店家

1. 在 `/login` 輸入任意未使用的測試信箱，例如 `howard-pilot@example.test`。
2. 到本機信箱 55324 開啟最新 magic link。
3. 建立店家。主要服務模板可選冷氣、水電、抓漏防水、裝修或一般到府服務；產品並未限定冷氣。
4. 完成頁應顯示一條「公開報修連結」。先不要關閉，複製該連結。

預期：重新整理後仍會進入同一組織，不會要求消費者 App 或客戶帳號。

## 3. 客戶免註冊進件

1. 用無痕／另一個瀏覽器視窗開啟公開報修連結。
2. 填姓名、電話、服務項目、需求標題、說明與地址，勾選隱私同意後送出。
3. 畫面應顯示 `SR-...`／`R-...` 參考編號。

預期：客戶不需註冊；回 owner 的 `/app/inbox` 可看到同一筆進件。這些資料已寫進 PostgreSQL，不是畫面 fixture。

## 4. 店內整理與分流

1. 在接案匣打開「查看並整理進件」。
2. 確認左側／上方的「原始需求」不可編輯；「整理後摘要」可修改。
3. 確認客戶與服務地點；選服務類別、優先度與負責人，可填內部備註。
4. 按「分流案件」。狀態應變成「已分流」。

預期：重新整理後摘要、綁定、分類、內部備註與負責人仍存在；原始需求未被覆寫。

## 5. 建立並送出真實報價

1. 按「建立／查看正式報價」。
2. 編輯標題、效期、客戶說明、內部備註、條款與品項。
3. 至少填數量、單位、客戶單價；成本只供店內使用，可選 0% 或外加 5% 稅率。
4. 切到「客戶預覽版」，確認沒有成本與內部備註。
5. 按「建立並儲存草稿」。成功後 URL 會變成 `/app/quotes/{id}`，並顯示 `Q-...` 編號。
6. owner／admin 勾選「我已檢查價格、範圍、效期與客戶版內容」，再按「核准並建立分享連結」。

預期：

- 未儲存的變更不能送出。
- dispatcher 可存草稿，但不能核准送出。
- 金額由 TypeScript 與 PostgreSQL 重新計算，client 傳入 total 會被拒絕。
- 送出版本變唯讀，不能原地修改。
- 畫面會誠實顯示「尚未接 LINE 自動通知」；請手動複製連結。

## 6. 客戶接受報價

1. 在客戶的無痕視窗開啟「客戶報價連結」。
2. 檢查店家、報價編號、v1、效期、品項、總額與條款。
3. 填「確認人姓名」與選填備註，按「接受報價」。
4. 第一次點擊只會開啟摘要 dialog；再按「確認送出」才真正寫入。
5. 回 owner 報價頁重新整理，應顯示「客戶已接受 v1」。
6. 按「回到進件並建立案件」，選單次到府或專案後確認轉換。

預期：客戶不需登入；同一決定重送不會建立第二筆事件，反向改成拒絕會被拒絕。接受後進件才可順暢轉案件，並顯示持久化 `WO-...` 或 `PJ-...` 編號。

## 7. 拒絕與 v2 修訂（建議另建一筆進件）

1. 重複建立並送出一份報價，客戶這次選「暫不接受」並二次確認。
2. owner 重新整理，應看到拒絕狀態與「複製成新版草稿」。
3. 建立 v2、修改內容、儲存並重新核准送出。

預期：v1 保持 rejected 且不可修改；v2 是新的 draft。若按「重新產生分享連結」，UI 會先要求確認，成功後舊連結顯示統一的無法使用頁。

## 8. 自動化驗證指令

```bash
npm run typecheck
npm run lint
npm run test:unit
npm run test:coverage
npm run test:sql
npm run test:integration
npm run lint:db
npm run build:local
npm run test:e2e:local
```

Playwright 首次執行若缺 Chromium：

```bash
npx playwright install chromium
```

## 9. 目前刻意尚未完成

- M5：案件／工單工作台、排程、指派後的技師任務、前後照、checklist 與完工。
- M6：LINE OA webhook、聊天自動進接案匣、主動狀態通知與失敗重試。目前公開表單／報價連結需手動貼入 LINE。
- M7：AI 從自由訊息整理草稿；即使未做 AI，M2–M4 人工流程仍可獨立使用。
- M8：付款、設備履歷、保養回訪與四項 KPI。
- Production hardening：真實 LINE 測試 channel、平台 Authorization header redaction 驗證、staging 雙租戶／限流演練、cleanup worker、iOS Safari／LIFF WebView 實機驗收。

`/demo` 仍是明確標示的互動展示；本手冊所有步驟都從 `/login` 與 `/request/{token}` 開始，兩者不要混用。
