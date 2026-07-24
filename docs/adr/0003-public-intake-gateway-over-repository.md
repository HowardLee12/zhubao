# ADR 0003：公開進件採 gateway 直呼 RPC，取代 repository service 平行實作

- 狀態：Accepted
- 日期：2026-07-18

## 背景

pilot 切片同時存在兩套公開進件（public intake）實作：

- `src/server/services/public-intake.ts`：以 repository pattern 抽象的 `createPublicIntakeService`，透過注入的 `PublicIntakeRepository` 建立進件，並自帶一份 `PublicIntakeGrant` scope/expiry/revoke 檢查與 `CreateServiceRequestInput`（`src/schemas/service-request.ts`）。它只有 colocated 單元測試，沒有任何 production route 匯入。
- `src/server/public-intake/gateway.ts`：實際被四條 `/api/v2/public/intake/{token}` route 使用的實作。它直接呼叫 `supabase/migrations` 內 pgTAP 釘住的 service-role-only RPC（`resolve_pilot_intake_config`、`create_pilot_intake_upload`、`get_pilot_intake_upload_verification`、`complete_pilot_intake_upload`、`submit_pilot_service_request`），並以 `src/schemas/public-intake.ts` 的 `.strict()` schema 對映 DB 回傳形狀。

兩者的租戶隔離、idempotency、rate limit、hash-chain 稽核與 grant 檢查都已在 SQL 層以 pgTAP（`04_pilot_intake.test.sql`，49 tests）驗證。repository service 的檢查是 TypeScript 端的第二份、且與真實 RPC 形狀不同的近似實作，形成雙 source of truth 與合約漂移風險（D2 家族）。

## 決策

以 `src/server/public-intake/gateway.ts` 為公開進件的唯一實作，並刪除被取代的平行實作：

- 刪除 `src/server/services/public-intake.ts` 與其測試 `src/server/services/public-intake.test.ts`。
- 刪除僅供該 service 使用、無其他 consumer 的 `src/schemas/service-request.ts` 與其測試 `src/schemas/service-request.test.ts`。

理由：

- gateway 直接對映 pgTAP 釘住的 RPC，安全與冪等不變式集中在資料庫層，符合 `docs/security.md` 與 `docs/database-spec.md` 的優先順序；不需要在 TS 端維護第二份 grant/idempotency 邏輯。
- repository service 從未接線，刪除不影響任何 production 路徑（已 grep 確認零 import）。
- 移除雙實作可消除 `CreateServiceRequestInput` 與真實 `submit_pilot_service_request` 形狀不一致造成的漂移面。

保留（非本 ADR 刪除範圍）：

- `src/server/domain/**`（quote-calculation/version/approval、work-order-state 等純函式）是 M4/M5 的既定 scaffolding，依 `docs/delivery-status.md` 待接線，不是死碼。
- `src/schemas/work-order.ts` 屬於 M5 work-order transition 契約；本輪只將其 `schedule` action 對齊 domain 的 `WORK_ORDER_ACTIONS`。

## 結果

- 公開進件只有一條實作路徑：route → `gateway.ts` → service-role RPC；DTO 邊界由 `src/schemas/public-intake.ts` 把關。
- 未來若需要 repository 抽象（例如非 Supabase 後端或單元層可替換性），必須重新提案，並且以真實 RPC 形狀為契約基礎、附整合測試，而非重建與 DB 漂移的第二份 schema。
- `docs/delivery-status.md` 的 D7「service-request.ts schema 待裁決」項目視為已結案。
