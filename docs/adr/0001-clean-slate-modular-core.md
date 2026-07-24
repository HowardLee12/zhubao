# ADR-0001：Clean-slate 共通核心與產業模板

- 狀態：Accepted
- 日期：2026-07-16

## 背景

v1 以裝修專案、工種、報價與分期款為核心，資料庫已刪除。v2 希望服務使用 LINE 接案的小型現場工程與到府服務團隊，並同時避免退化為沒有產業深度的通用派工工具。

## 決策

v2 不相容 v1 schema，建立全新多租戶資料模型。產品以一次可交付的 `work_order` 為核心，透過選配模組支援不同工作型態：

- 到府服務：`assets`、`assignments`、`checklists`、`maintenance_plans`。
- 小型工程：`projects`、`change_orders`、`payment_milestones`、簽認證據。
- 共通：客戶、地點、進件、報價版本、照片、事件、通知與 LINE channel。

前端使用產業模板控制預設欄位、服務目錄、檢查表、狀態標籤與導覽曝光；不複製整套程式或資料庫。

## 理由

- 沒有舊資料遷移成本，可在第一天建立正確的租戶與權限邊界。
- 冷氣、水電、抓漏／防水共享大部分「進件到完工」流程。
- `projects` 與 `assets` 同時作為選配，避免用裝修語意硬套單次服務，也避免用單次工單硬套多日工程。
- 共通核心降低後續產業模板的開發與測試成本。

## 後果

- v1 的 queries、server actions 與資料型別不能直接沿用，必須依 v2 repository/service 邊界重寫。
- 報價、排程、照片、PDF、LIFF 與 UI primitive 可重用，但需改接 v2 domain。
- 在真實試點前，必須完成跨租戶 negative tests、私有媒體與安全分享 token。
- 若某產業要求大量獨有欄位，先以模板設定或獨立模組解決，不擴張共通核心。
