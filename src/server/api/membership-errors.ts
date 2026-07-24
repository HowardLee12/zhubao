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

// Maps an invite_pilot_member / list_pilot_members RPC exception to an RFC-9457
// problem. The RPCs raise a stable message string with a SQLSTATE; the message is
// the contract the route matches on.
//
//   AUTH_REQUIRED               -> 401
//   FORBIDDEN                   -> 403 (non-manager or cross-tenant caller)
//   MEMBERSHIP_ALREADY_EXISTS   -> 409 (user already has a membership in the org)
//   PILOT_INVALID_ROLE          -> 422 (owner or unknown role reached the RPC)
//   PILOT_VALIDATION_FAILED     -> 422 (display_name / phone / key shape)
//   idempotency conflicts       -> 409
export function mapMembershipRpcError(error: RpcErrorLike): ApiProblem {
  const combined = `${error.message ?? ""} ${error.details ?? ""}`;

  if (combined.includes("AUTH_REQUIRED")) {
    return authenticationRequiredProblem();
  }
  if (combined.includes("FORBIDDEN")) {
    return new ApiProblem({
      status: 403,
      code: "FORBIDDEN",
      title: "沒有權限",
      detail: "你沒有權限管理這個店家的成員。",
    });
  }
  if (combined.includes("MEMBERSHIP_ALREADY_EXISTS")) {
    return new ApiProblem({
      status: 409,
      code: "MEMBERSHIP_ALREADY_EXISTS",
      title: "成員已存在",
      detail: "這個 Email 已經是這個店家的成員，無法重複新增。",
    });
  }
  if (
    combined.includes("PILOT_INVALID_ROLE") ||
    combined.includes("PILOT_VALIDATION_FAILED")
  ) {
    return new ApiProblem({
      status: 422,
      code: "VALIDATION_FAILED",
      title: "資料不正確",
      detail: "姓名、角色或電話格式不正確，請調整後再試一次。",
    });
  }
  if (
    combined.includes("PILOT_IDEMPOTENCY_CONFLICT") ||
    combined.includes("PILOT_IDEMPOTENCY_IN_PROGRESS")
  ) {
    return new ApiProblem({
      status: 409,
      code: "IDEMPOTENCY_CONFLICT",
      title: "重複的要求",
      detail: "這個新增要求正在處理或與先前的要求衝突，請稍後再試一次。",
    });
  }

  return internalApiProblem();
}
