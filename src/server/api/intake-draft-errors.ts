import { ApiProblem } from "./problem";
import { authenticationRequiredProblem, internalApiProblem } from "@/server/supabase/http";

interface RpcErrorLike {
  message?: string;
  details?: string;
  code?: string;
}

// Maps a confirm/dismiss intake-draft RPC exception to an RFC-9457 problem. The RPCs
// raise a message string with a SQLSTATE; the message is the stable contract the
// routes match on. Cross-tenant and not-found both collapse to a non-leaky 404, and
// the owner/admin/dispatcher gate (has_org_role) surfaces as 403.
export function mapIntakeDraftRpcError(error: RpcErrorLike): ApiProblem {
  const combined = `${error.message ?? ""} ${error.details ?? ""}`;

  if (combined.includes("AUTH_REQUIRED")) {
    return authenticationRequiredProblem();
  }
  if (combined.includes("FORBIDDEN")) {
    return new ApiProblem({
      status: 403,
      code: "FORBIDDEN",
      title: "沒有權限",
      detail: "你沒有權限對這個進件草稿執行這個操作。",
    });
  }
  if (combined.includes("STALE_VERSION")) {
    return new ApiProblem({
      status: 412,
      code: "VERSION_CONFLICT",
      title: "版本已變更",
      detail: "這個進件草稿已被他人更新，請重新整理後再試一次。",
    });
  }
  if (
    combined.includes("INTAKE_DRAFT_NOT_FOUND") ||
    combined.includes("CONVERSATION_NOT_FOUND")
  ) {
    return new ApiProblem({
      status: 404,
      code: "NOT_FOUND",
      title: "找不到進件草稿",
      detail: "找不到這個進件草稿。",
    });
  }

  // Illegal state at the current draft status (409).
  if (
    combined.includes("INTAKE_DRAFT_NOT_CONFIRMABLE") ||
    combined.includes("INTAKE_DRAFT_NOT_DISMISSABLE")
  ) {
    return new ApiProblem({
      status: 409,
      code: "INVALID_STATE_TRANSITION",
      title: "無法執行這個操作",
      detail: "這個進件草稿目前的狀態不允許這個操作，請重新整理後再確認。",
    });
  }

  return internalApiProblem();
}
