import { ApiProblem } from "./problem";
import {
  authenticationRequiredProblem,
  internalApiProblem,
} from "@/server/supabase/http";

interface RpcErrorLike {
  message?: string;
  details?: string;
  code?: string;
}

// Maps a service-request RPC exception (triage/convert/transition) to an RFC-9457
// problem per the M3 error taxonomy. The RPCs raise a message string with a
// SQLSTATE; the message is the stable contract the routes match on. Cross-tenant
// and not-found both collapse to a non-leaky 404.
export function mapServiceRequestRpcError(error: RpcErrorLike): ApiProblem {
  const combined = `${error.message ?? ""} ${error.details ?? ""}`;

  if (combined.includes("AUTH_REQUIRED")) {
    return authenticationRequiredProblem();
  }
  if (combined.includes("FORBIDDEN")) {
    return new ApiProblem({
      status: 403,
      code: "FORBIDDEN",
      title: "沒有權限",
      detail: "你沒有權限對這個案件執行這個操作。",
    });
  }
  if (combined.includes("STALE_VERSION")) {
    return new ApiProblem({
      status: 412,
      code: "VERSION_CONFLICT",
      title: "版本已變更",
      detail: "這個案件已被他人更新，請重新整理後再試一次。",
    });
  }
  if (combined.includes("SERVICE_REQUEST_NOT_FOUND")) {
    return new ApiProblem({
      status: 404,
      code: "NOT_FOUND",
      title: "找不到案件",
      detail: "找不到這個案件。",
    });
  }

  // Illegal state / business-rule violations at the current status (409).
  const conflictSignals = [
    "INVALID_SERVICE_REQUEST_TRANSITION",
    "TRIAGE_REQUIRES_CUSTOMER",
    "CONVERSION_TARGET_REQUIRED",
    "INVALID_CONVERSION_MODE",
    "CLOSE_REASON_REQUIRED",
    "QUOTED_REQUIRES_SENT_QUOTE",
    "INVALID_PRIORITY",
    "INVALID_CATEGORY",
  ];
  if (conflictSignals.some((signal) => combined.includes(signal))) {
    return new ApiProblem({
      status: 409,
      code: "INVALID_STATE_TRANSITION",
      title: "無法執行這個操作",
      detail: "案件目前的狀態或內容不允許這個操作，請重新整理後再確認。",
    });
  }

  // Referential/scope mismatches on the supplied bindings (422).
  const unprocessableSignals = [
    "CUSTOMER_NOT_IN_ORG",
    "LOCATION_CUSTOMER_MISMATCH",
    "ASSET_SCOPE_MISMATCH",
    "MEMBER_NOT_ACTIVE",
    "MEMBER_NOT_ASSIGNABLE",
  ];
  if (unprocessableSignals.some((signal) => combined.includes(signal))) {
    return new ApiProblem({
      status: 422,
      code: "VALIDATION_FAILED",
      title: "綁定的資料不正確",
      detail: "選擇的客戶、地址、設備或負責人不屬於這個店家，請重新選擇。",
    });
  }

  if (combined.includes("INVALID_LIMIT") || combined.includes("PILOT_VALIDATION_FAILED")) {
    return new ApiProblem({
      status: 400,
      code: "VALIDATION_FAILED",
      title: "查詢參數不正確",
      detail: "查詢參數超出允許範圍，請調整後再試一次。",
    });
  }

  // A convert-once race surfaces as a unique_violation on converted_*.
  if (error.code === "23505" || combined.includes("unique")) {
    return new ApiProblem({
      status: 409,
      code: "INVALID_STATE_TRANSITION",
      title: "案件已轉換",
      detail: "這個案件已被轉換，請重新整理後前往既有案件。",
    });
  }

  return internalApiProblem();
}
