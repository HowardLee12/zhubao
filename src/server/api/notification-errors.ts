import { ApiProblem } from "./problem";
import { internalApiProblem } from "@/server/supabase/http";

interface RpcErrorLike {
  message?: string;
  details?: string;
  hint?: string;
  code?: string;
}

function combined(error: RpcErrorLike): string {
  return `${error.message ?? ""} ${error.details ?? ""} ${error.hint ?? ""}`;
}

// Maps a notification/outbox RPC exception to an RFC-9457 problem. The RPCs raise
// stable message strings; cross-tenant and missing rows both collapse to a
// non-leaky 404. From-state guards become 409 (the row cannot transition now).
export function mapNotificationRpcError(error: RpcErrorLike): ApiProblem {
  const value = combined(error);

  if (value.includes("FORBIDDEN")) {
    return new ApiProblem({
      status: 403,
      code: "FORBIDDEN",
      title: "沒有權限",
      detail: "你沒有權限檢視或管理這個組織的通知。",
    });
  }

  if (value.includes("NOTIFICATION_NOT_FOUND")) {
    return new ApiProblem({
      status: 404,
      code: "NOT_FOUND",
      title: "找不到通知",
      detail: "找不到這個通知，或它不屬於這個組織。",
    });
  }

  if (
    value.includes("NOTIFICATION_NOT_CANCELLABLE") ||
    value.includes("NOTIFICATION_NOT_RETRYABLE")
  ) {
    return new ApiProblem({
      status: 409,
      code: "INVALID_STATE_TRANSITION",
      title: "無法執行這個操作",
      detail: "通知目前的狀態不允許這個操作，請重新整理後再確認。",
    });
  }

  return internalApiProblem();
}
