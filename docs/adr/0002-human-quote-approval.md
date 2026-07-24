# ADR 0002：報價內部核准與對客狀態分離

- 狀態：Accepted
- 日期：2026-07-16

## 背景

Renoly 可以由 AI 或 dispatcher 整理報價草稿，但產品承諾是 owner 確認後才對客送出。若把「待核准」塞進 quote 的 customer lifecycle，會讓版本不可變、客戶查看與修訂規則互相耦合。

## 決策

`quote_version` 同時保存兩條獨立 lifecycle：

- 對客版本：`draft/sent/superseded/accepted/rejected/expired/cancelled`。
- 內部核准：`not_submitted/pending/approved/changes_requested`。

Phase 1 中 dispatcher 可建立、編輯與送審；owner 可要求修改、核准與送出。預留的 admin 具 owner 等級的核准權，但 Phase 1 UI 不開放指派 admin。

只有 `approved` draft 可送出。任何影響金額、品項、條款或客戶可見內容的修改都使核准失效；已送出版本不可原地修改。owner/admin 可在同一 transaction 執行 approve-and-send，但 event 必須同時留下核准與送出兩個 domain fact。

## 結果

- AI 永遠只能產生 draft，不能透過欄位更新取得 approved/sent。
- API 需要 submit-approval、approve、request-changes、send actions。
- RLS/RPC 與 domain 測試必須阻止 dispatcher 直接送出。
- 未來若店家選擇「dispatcher 可自行核准」，必須是明確 organization policy、具 audit event，不能靠前端隱藏或直接 PATCH。
