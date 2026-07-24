# ADR 0005：Pilot staff 資料存取採 authenticated-only RPC

- 狀態：Accepted
- 日期：2026-07-19

## 背景

M3 詳情頁需要讀取案件、時段、照片 metadata、客戶、地址、設備與事件，並允許老闆修正 AI／人工整理後的摘要。基礎資料表刻意不授權給 `authenticated`；早期實作先以 caller session 驗證 manager，再用 service role 執行 tenant-filtered table query。

雖然 route 有 organization filter，這仍讓一般 request path 繞過 RLS，並把「每一條 query 都正確帶 tenant 條件」變成唯一防線。原 PATCH 也直接 update row，沒有在同一 transaction append audit event；更新後回應還把時段／照片清成空陣列。

## 決策

1. staff domain route 一律以 caller 的 Supabase session 呼叫 `authenticated` 專用 `SECURITY DEFINER` RPC，不可用 service role 補讀：
   - `get_pilot_service_request_detail`
   - `update_pilot_service_request_summary`
   - `list_pilot_customers`
   - `list_pilot_customer_locations`
   - `list_pilot_customer_assets`
   - `list_pilot_service_request_events`
   - `list_pilot_assignable_members`
2. RPC owner 為 non-login `renoly_rls_owner`，固定 `search_path`、revoke `public/anon/service_role` execute，並在 function 內重驗 active organization 與 `owner/admin/dispatcher` membership。
3. 回傳值是明確 allowlist JSON，不回 `organization_id`、成本、deleted metadata 或事件中的 raw `submission` 副本。
4. 摘要 PATCH 僅接受 subject/description/priority/category/contact 欄位；row lock 後驗 `lock_version`，保留 immutable `original_submission`，寫 editor provenance，並 append `service_request.summary_updated` event 後才回完整 workspace。
5. service role 的唯一 M3 例外是 private Storage 短效 URL 簽發。signer 只能接收上述 RPC 已授權的 `{id, category, storage_path}`，不得自行查 `photos` 或任何 domain table。

## 結果

- HTTP 與 DB 各有一層角色／tenant 防線；route 漏 filter 不會直接變成跨租戶讀取。
- 摘要編輯、optimistic concurrency 與 audit event 原子化。
- GET/PATCH 都回相同完整 workspace，前端不會在儲存後暫時遺失時段或照片。
- pgTAP `07_m3_staff_access_hardening.test.sql` 釘住 function privilege、角色、跨租戶、不可變原文、驗證、稽核、literal search、可指派成員與 timeline redaction。
