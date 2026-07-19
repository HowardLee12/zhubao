import { ApiProblem } from "./problem";
import {
  authenticationRequiredProblem,
  internalApiProblem,
} from "@/server/supabase/http";

interface RpcErrorLike {
  message?: string;
  details?: string;
  hint?: string;
  code?: string;
}

function combined(error: RpcErrorLike): string {
  return `${error.message ?? ""} ${error.details ?? ""} ${error.hint ?? ""}`;
}

export function mapQuoteRpcError(error: RpcErrorLike): ApiProblem {
  const value = combined(error);
  if (value.includes("AUTH_REQUIRED")) return authenticationRequiredProblem();
  if (value.includes("FORBIDDEN") || value.includes("ROLE_REQUIRED")) {
    return new ApiProblem({
      status: 403,
      code: "FORBIDDEN",
      title: "沒有權限",
      detail: "你沒有權限執行這個報價操作。",
    });
  }
  if (value.includes("STALE_VERSION")) {
    return new ApiProblem({
      status: 412,
      code: "VERSION_CONFLICT",
      title: "版本已變更",
      detail: "這份報價或進件已被更新，請重新整理後再試一次。",
    });
  }
  if (value.includes("QUOTE_NOT_FOUND") || value.includes("QUOTE_VERSION_NOT_FOUND")) {
    return new ApiProblem({
      status: 404,
      code: "NOT_FOUND",
      title: "找不到報價",
      detail: "找不到這份報價。",
    });
  }
  if (value.includes("PILOT_IDEMPOTENCY_CONFLICT")) {
    return new ApiProblem({
      status: 409,
      code: "IDEMPOTENCY_CONFLICT",
      title: "重複要求內容不一致",
      detail: "請重新整理後再執行一次。",
    });
  }
  if (value.includes("PILOT_IDEMPOTENCY_IN_PROGRESS")) {
    return new ApiProblem({
      status: 409,
      code: "IDEMPOTENCY_IN_PROGRESS",
      title: "要求仍在處理",
      detail: "請稍候再確認結果。",
    });
  }
  const conflicts = [
    "ACTIVE_VERSION_CHANGED",
    "QUOTE_VERSION_IMMUTABLE",
    "QUOTE_ALREADY_RESOLVED",
    "QUOTE_REVISION_NOT_ALLOWED",
    "QUOTE_REQUEST_NOT_READY",
    "QUOTE_ITEMS_REQUIRED",
    "QUOTE_ALREADY_EXPIRED",
    "QUOTE_ALREADY_EXISTS",
    "QUOTE_ACCEPTANCE_REQUIRED",
  ];
  if (conflicts.some((signal) => value.includes(signal)) || error.code === "23505") {
    return new ApiProblem({
      status: 409,
      code: "INVALID_QUOTE_STATE",
      title: "目前無法執行這個報價操作",
      detail: "報價狀態已改變，請重新整理後確認。",
    });
  }
  if (value.includes("PILOT_VALIDATION_FAILED") || value.includes("QUOTE_BINDING_MISMATCH")) {
    return new ApiProblem({
      status: 422,
      code: "VALIDATION_FAILED",
      title: "報價資料不正確",
      detail: "請檢查客戶、地址、品項與金額後再試一次。",
    });
  }
  return internalApiProblem();
}

export function mapPublicQuoteRpcError(error: RpcErrorLike): ApiProblem {
  const value = combined(error);
  if (value.includes("PUBLIC_QUOTE_LINK_INVALID")) {
    return new ApiProblem({
      status: 404,
      code: "PUBLIC_LINK_NOT_FOUND",
      title: "連結無法使用",
      detail: "此報價連結不存在、已過期或已被撤銷。",
    });
  }
  if (value.includes("PILOT_IDEMPOTENCY_CONFLICT")) {
    return new ApiProblem({
      status: 409,
      code: "IDEMPOTENCY_CONFLICT",
      title: "重複送出內容不一致",
      detail: "請重新整理報價頁後再確認。",
    });
  }
  if (value.includes("PILOT_IDEMPOTENCY_IN_PROGRESS")) {
    return new ApiProblem({
      status: 409,
      code: "IDEMPOTENCY_IN_PROGRESS",
      title: "回覆仍在處理",
      detail: "請稍候再確認結果。",
    });
  }
  if (value.includes("QUOTE_ALREADY_RESOLVED")) {
    return new ApiProblem({
      status: 409,
      code: "QUOTE_ALREADY_RESOLVED",
      title: "報價已有回覆",
      detail: "這份報價已經接受或拒絕，無法改成另一個結果。",
    });
  }
  if (value.includes("ACTIVE_VERSION_CHANGED")) {
    return new ApiProblem({
      status: 409,
      code: "ACTIVE_VERSION_CHANGED",
      title: "報價已有新版",
      detail: "店家已更新報價，請重新開啟最新連結。",
    });
  }
  if (value.includes("QUOTE_EXPIRED") || value.includes("QUOTE_NOT_RESPONDABLE")) {
    return new ApiProblem({
      status: 409,
      code: "QUOTE_NOT_RESPONDABLE",
      title: "目前無法回覆這份報價",
      detail: "報價已過期或狀態已變更，請聯絡店家。",
    });
  }
  if (value.includes("PILOT_VALIDATION_FAILED")) {
    return new ApiProblem({
      status: 422,
      code: "VALIDATION_FAILED",
      title: "回覆資料不正確",
      detail: "請檢查姓名與回覆內容後再送出。",
    });
  }
  return internalApiProblem();
}
