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

export interface ScheduleConflictEntry {
  membershipId: string;
  workOrderId: string;
  workOrderNo: string;
  startsAt: string | null;
  endsAt: string | null;
}

// A schedule conflict is a 409 that additionally carries the overlapping
// work-order windows so the caller can render an actionable choice (reschedule,
// reassign, or owner override). The conflicts[] are read from the raised
// PG_EXCEPTION_DETAIL, which the RPC populates with the conflict JSON.
export class WorkOrderScheduleConflict extends ApiProblem {
  readonly conflicts: ScheduleConflictEntry[];

  constructor(conflicts: ScheduleConflictEntry[]) {
    super({
      status: 409,
      code: "SCHEDULE_CONFLICT",
      title: "排程時段衝突",
      detail: "指派的技師在這個時段已有其他工單，請改期、改派或由管理者覆寫。",
    });
    this.conflicts = conflicts;
  }
}

function parseConflicts(detail: string | undefined): ScheduleConflictEntry[] {
  if (!detail) return [];
  try {
    const parsed = JSON.parse(detail);
    return Array.isArray(parsed) ? (parsed as ScheduleConflictEntry[]) : [];
  } catch {
    return [];
  }
}

function combined(error: RpcErrorLike): string {
  return `${error.message ?? ""} ${error.details ?? ""} ${error.hint ?? ""}`;
}

const NOT_FOUND_SIGNALS = [
  "WORK_ORDER_NOT_FOUND",
  "ASSIGNMENT_NOT_FOUND",
  "CHECKLIST_NOT_FOUND",
  "CHECKLIST_ITEM_NOT_FOUND",
  "PHOTO_NOT_FOUND",
];

// 422: input/binding/gate-precondition problems that mean "fix the request".
const UNPROCESSABLE_SIGNALS = [
  "WORK_ORDER_PAYLOAD_INVALID",
  "SCHEDULE_PAYLOAD_INVALID",
  "ASSIGNMENT_PAYLOAD_INVALID",
  "ASSIGNMENT_RESPONSE_INVALID",
  "CHECKLIST_PAYLOAD_INVALID",
  "CHECKLIST_ITEM_INVALID",
  "CHECKLIST_RESPONSE_REQUIRED",
  "CHECKLIST_RESPONSE_TYPE_INVALID",
  "PHOTO_VERIFICATION_INVALID",
  "PHOTO_UPDATE_INVALID",
  "OCCURRED_AT_REQUIRED",
  "OCCURRED_AT_OUT_OF_RANGE",
  "FORCE_COMPLETE_REASON_REQUIRED",
  "COMPLETION_SUMMARY_REQUIRED",
  "REQUIRED_CHECKLIST_INCOMPLETE",
  "REQUIRED_EVIDENCE_MISSING",
  "BEFORE_AFTER_PHOTOS_REQUIRED",
  "CUSTOMER_SIGNOFF_REQUIRED",
  "ASSIGNMENT_CANCEL_REASON_REQUIRED",
  "DECLINE_REASON_REQUIRED",
  "SCHEDULE_CONFLICT_QUERY_INVALID",
  "LIST_PAGE_SIZE_INVALID",
  "WORK_ORDER_BINDING_MISMATCH",
  "TRANSITION_REASON_REQUIRED",
  "SCHEDULE_REQUIRED",
  "ACTIVE_ASSIGNMENT_REQUIRED",
];

// 409: current-state / limit / idempotency / duplicate conflicts.
const CONFLICT_SIGNALS = [
  "WORK_ORDER_NOT_SCHEDULABLE",
  "WORK_ORDER_NOT_ASSIGNABLE",
  "WORK_ORDER_NOT_UPLOADABLE",
  "WORK_ORDER_NOT_EDITABLE_ON_SITE",
  "WORK_ORDER_NOT_EDITABLE",
  "WORK_ORDER_MANAGER_ACTION_REQUIRED",
  "INVALID_WORK_ORDER_TRANSITION",
  "INVALID_ASSIGNMENT_TRANSITION",
  "ASSIGNMENT_NOT_EDITABLE",
  "ASSIGNMENT_CANCEL_REQUIRES_MANAGER",
  "ASSIGNMENT_LIMIT_EXCEEDED",
  "CHECKLIST_ALREADY_COMPLETED",
  "PHOTO_ALREADY_READY",
  "PHOTO_NOT_PENDING",
  "PHOTO_DELETED",
  "PHOTO_IS_COMPLETION_EVIDENCE",
  "IDEMPOTENCY_CONFLICT",
  "IDEMPOTENCY_IN_PROGRESS",
  "SCHEDULE_DUPLICATE_MEMBER",
  "REOPEN_NOT_ALLOWED",
];

// Maps a work-order operations RPC exception to an RFC-9457 problem. RPCs raise a
// stable message string (with a SQLSTATE); the route matches on the message.
// Cross-tenant and missing rows both collapse to a non-leaky 404. SCHEDULE_CONFLICT
// keeps the overlapping windows so the UI can offer a resolution.
export function mapWorkOrderRpcError(error: RpcErrorLike): ApiProblem {
  const value = combined(error);

  if (value.includes("AUTH_REQUIRED")) return authenticationRequiredProblem();

  if (
    value.includes("FORBIDDEN") ||
    value.includes("FORCE_COMPLETE_REQUIRES_OWNER") ||
    value.includes("PHOTO_VERIFICATION_MISMATCH")
  ) {
    return new ApiProblem({
      status: 403,
      code: "FORBIDDEN",
      title: "沒有權限",
      detail: "你沒有權限對這個工單執行這個操作。",
    });
  }

  if (value.includes("STALE_VERSION")) {
    return new ApiProblem({
      status: 412,
      code: "VERSION_CONFLICT",
      title: "版本已變更",
      detail: "這個工單已被他人更新，請重新整理後再試一次。",
    });
  }

  if (NOT_FOUND_SIGNALS.some((signal) => value.includes(signal))) {
    return new ApiProblem({
      status: 404,
      code: "NOT_FOUND",
      title: "找不到資源",
      detail: "找不到這個工單、指派或照片。",
    });
  }

  if (value.includes("SCHEDULE_CONFLICT") && !value.includes("SCHEDULE_CONFLICT_QUERY_INVALID")) {
    return new WorkOrderScheduleConflict(parseConflicts(error.details));
  }

  if (UNPROCESSABLE_SIGNALS.some((signal) => value.includes(signal))) {
    return new ApiProblem({
      status: 422,
      code: "VALIDATION_FAILED",
      title: "資料不正確或條件未滿足",
      detail: "請檢查輸入內容或完工前必要項目後再試一次。",
    });
  }

  if (CONFLICT_SIGNALS.some((signal) => value.includes(signal)) || error.code === "23505") {
    return new ApiProblem({
      status: 409,
      code: "INVALID_STATE_TRANSITION",
      title: "無法執行這個操作",
      detail: "工單目前的狀態或內容不允許這個操作，請重新整理後再確認。",
    });
  }

  return internalApiProblem();
}
