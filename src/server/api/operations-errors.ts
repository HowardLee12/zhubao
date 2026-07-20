import { ApiProblem } from "./problem";
import { authenticationRequiredProblem, internalApiProblem } from "@/server/supabase/http";

interface RpcErrorLike {
  message?: string;
  details?: string;
  hint?: string;
  code?: string;
}

function combined(error: RpcErrorLike): string {
  return `${error.message ?? ""} ${error.details ?? ""} ${error.hint ?? ""}`;
}

// 429: authenticated rate limiter tripped. Callers throw this directly when the
// consume RPC returns 'limited'; it is also matched here for defence in depth.
export function rateLimitedProblem(): ApiProblem {
  return new ApiProblem({
    status: 429,
    code: "RATE_LIMITED",
    title: "要求過於頻繁",
    detail: "操作次數過多，請稍後再試。",
  });
}

const NOT_FOUND_SIGNALS = [
  "PAYMENT_MILESTONE_NOT_FOUND",
  "MAINTENANCE_PLAN_NOT_FOUND",
  "ASSET_NOT_FOUND",
  "DATA_DELETION_REQUEST_NOT_FOUND",
  "PROJECT_NOT_FOUND",
  "CHANGE_ORDER_NOT_FOUND",
  "QUOTE_VERSION_NOT_FOUND",
  "WORK_ORDER_NOT_FOUND",
];

// 422: fix-the-request problems (payload/amount/reason/range validation).
const UNPROCESSABLE_SIGNALS = [
  "PAYMENT_PAYLOAD_INVALID",
  "PAYMENT_AMOUNT_INVALID",
  "PAYMENT_REASON_REQUIRED",
  "PAYMENT_REVERSE_REASON_REQUIRED",
  "MAINTENANCE_PAYLOAD_INVALID",
  "MAINTENANCE_CADENCE_INVALID",
  "MAINTENANCE_REASON_REQUIRED",
  "MAINTENANCE_BATCH_TOO_LARGE",
  "ASSET_PAYLOAD_INVALID",
  "ASSET_EVENT_PAYLOAD_INVALID",
  "ASSET_EVENT_TYPE_INVALID",
  "DASHBOARD_RANGE_INVALID",
  "DASHBOARD_RANGE_TOO_LARGE",
  "NOTIFICATION_PAYLOAD_INVALID",
  "NOTIFICATION_BATCH_TOO_LARGE",
  "NOTIFICATION_APPROVAL_STATUS_INVALID",
  "RATE_LIMIT_PAYLOAD_INVALID",
  "RATE_LIMIT_ACTION_INVALID",
];

// 409: current-state / convertibility / open-request conflicts.
const CONFLICT_SIGNALS = [
  "PAYMENT_MILESTONE_NOT_INVOICEABLE",
  "PAYMENT_MILESTONE_NOT_PAYABLE",
  "PAYMENT_MILESTONE_NOT_WAIVABLE",
  "PAYMENT_MILESTONE_NOT_CANCELLABLE",
  "PAYMENT_MILESTONE_NOT_REVERSIBLE",
  "PAYMENT_REVERSE_AMOUNT_MUTATED",
  "MAINTENANCE_PLAN_NOT_EDITABLE",
  "MAINTENANCE_PLAN_TRANSITION_INVALID",
  "MAINTENANCE_PLAN_NOT_COMPLETABLE",
  "MAINTENANCE_PLAN_NOT_CONVERTIBLE",
  "ASSET_RETIRED",
  "ASSET_ALREADY_RETIRED",
  "DATA_DELETION_REQUEST_CANCELLED",
  "IDEMPOTENCY_CONFLICT",
  "IDEMPOTENCY_IN_PROGRESS",
];

// Maps an M8 operations (payment/maintenance/asset/report/deletion) RPC exception
// to an RFC-9457 problem. Cross-tenant and missing rows collapse to a non-leaky
// 404. Sensitive-field rejection on mark-paid becomes a dedicated 422. Open-request
// conflict on revisit-convert (RENOP) becomes a 409 that names the choice.
export function mapOperationsRpcError(error: RpcErrorLike): ApiProblem {
  const value = combined(error);

  if (value.includes("AUTH_REQUIRED")) return authenticationRequiredProblem();

  if (value.includes("PAYMENT_SENSITIVE_FIELD_REJECTED") || error.code === "RENSF") {
    return new ApiProblem({
      status: 422,
      code: "SENSITIVE_FIELD_REJECTED",
      title: "不接受敏感付款資料",
      detail:
        "本系統僅追蹤請款與收款狀態，不處理卡號、CVV 或銀行密碼等金流資料，請移除後再試。",
    });
  }

  if (
    value.includes("FORBIDDEN") ||
    value.includes("ROLE_REQUIRED") ||
    value.includes("OWNER_REQUIRED") ||
    value.includes("REAUTH_INVALID")
  ) {
    return new ApiProblem({
      status: 403,
      code: "FORBIDDEN",
      title: "沒有權限",
      detail: "你沒有權限對這個資源執行這個操作。",
    });
  }

  if (value.includes("STALE_VERSION")) {
    return new ApiProblem({
      status: 412,
      code: "VERSION_CONFLICT",
      title: "版本已變更",
      detail: "這個資源已被他人更新，請重新整理後再試一次。",
    });
  }

  if (value.includes("ASSET_HAS_OPEN_REQUEST") || error.code === "RENOP") {
    return new ApiProblem({
      status: 409,
      code: "OPEN_REQUEST_CONFLICT",
      title: "已有進行中的案件",
      detail: "這個設備或客戶已有進行中的案件，請人工確認後再選擇是否強制建立新案。",
    });
  }

  if (NOT_FOUND_SIGNALS.some((signal) => value.includes(signal))) {
    return new ApiProblem({
      status: 404,
      code: "NOT_FOUND",
      title: "找不到資源",
      detail: "找不到這個資源，或它不屬於這個組織。",
    });
  }

  if (UNPROCESSABLE_SIGNALS.some((signal) => value.includes(signal))) {
    return new ApiProblem({
      status: 422,
      code: "VALIDATION_FAILED",
      title: "資料不正確",
      detail: "請檢查輸入內容後再試一次。",
    });
  }

  if (CONFLICT_SIGNALS.some((signal) => value.includes(signal)) || error.code === "23505") {
    return new ApiProblem({
      status: 409,
      code: "INVALID_STATE_TRANSITION",
      title: "無法執行這個操作",
      detail: "資源目前的狀態不允許這個操作，請重新整理後再確認。",
    });
  }

  return internalApiProblem();
}
