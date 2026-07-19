import type {
  PhotoCategory,
  WorkOrderDetail,
  WorkOrderPriority,
  WorkOrderStatus,
} from "./work-order-api";

/**
 * Presentation-only mappings for the M5 work-order surfaces. Kept separate from
 * the API seam so both dispatcher and technician screens share one vocabulary
 * and the component files stay small.
 */

export const WORK_ORDER_STATUS_LABELS: Record<WorkOrderStatus, string> = {
  draft: "待排程",
  scheduled: "已排程",
  dispatched: "已派工",
  en_route: "前往中",
  on_site: "施工中",
  paused: "暫停中",
  completed: "已完工",
  cancelled: "已取消",
};

export const PRIORITY_LABELS: Record<WorkOrderPriority, string> = {
  low: "低",
  normal: "一般",
  high: "高",
  urgent: "緊急",
};

export const PHOTO_CATEGORY_LABELS: Record<PhotoCategory, string> = {
  intake: "報修",
  before: "施工前",
  after: "施工後",
  issue: "異常",
  receipt: "單據",
  signature: "簽認",
  other: "其他",
};

export const ASSIGNMENT_STATUS_LABELS: Record<string, string> = {
  assigned: "待回覆",
  accepted: "已接受",
  declined: "已婉拒",
  checked_in: "已報到",
  completed: "已完成",
  cancelled: "已取消",
};

export const DUTY_LABELS: Record<string, string> = {
  lead: "主責",
  technician: "技師",
  helper: "協助",
  observer: "見習",
};

const ACTIVE_ASSIGNMENT_STATUSES = new Set(["assigned", "accepted", "checked_in"]);

export function isActiveAssignmentStatus(status: string): boolean {
  return ACTIVE_ASSIGNMENT_STATUSES.has(status);
}

export function statusLabel(status: WorkOrderStatus): string {
  return WORK_ORDER_STATUS_LABELS[status] ?? status;
}

export function priorityLabel(priority: WorkOrderPriority): string {
  return PRIORITY_LABELS[priority] ?? priority;
}

export function photoCategoryLabel(category: PhotoCategory): string {
  return PHOTO_CATEGORY_LABELS[category] ?? category;
}

// Displays a UTC timestamp in the Asia/Taipei wall clock the crews work in.
export function formatDateTime(value: string | null): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(parsed);
}

export function formatTimeRange(start: string | null, end: string | null): string {
  if (!start) return "尚未排程";
  const startLabel = formatDateTime(start);
  if (!end) return startLabel;
  const endParsed = new Date(end);
  if (Number.isNaN(endParsed.getTime())) return startLabel;
  const endTime = new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(endParsed);
  return `${startLabel} – ${endTime}`;
}

export const MANAGER_ROLES = new Set(["owner", "admin", "dispatcher"]);
export const OWNER_ROLES = new Set(["owner", "admin"]);

// The single primary action a technician takes at each stage of the field flow.
// domain-glossary §4: 已確認/施工中/待確認 are UI projections of dispatched/
// on_site/paused — the underlying status enum is never extended.
export interface FieldAction {
  action: "enRoute" | "arrive" | "pause" | "resume" | "complete";
  label: string;
}

export function nextFieldAction(status: WorkOrderStatus): FieldAction | null {
  switch (status) {
    case "dispatched":
      return { action: "enRoute", label: "出發前往" };
    case "en_route":
      return { action: "arrive", label: "抵達現場" };
    case "on_site":
      return { action: "complete", label: "完工回報" };
    case "paused":
      return { action: "resume", label: "恢復施工" };
    default:
      return null;
  }
}

// The completion gate the DB enforces authoritatively (transition_work_order):
// required checklist items answered + every evidence-required item has a ready
// photo + >=1 ready 'before' + >=1 ready 'after' + a non-empty summary. This
// mirror is used ONLY to name what is missing so the block message is specific
// (J06-AC03) and to disable the button pre-flight — the DB, not this, is the gate.

export interface CompletionBlocker {
  code:
    | "requiredChecklist"
    | "requiredEvidence"
    | "beforePhoto"
    | "afterPhoto"
    | "completionSummary";
  message: string;
  itemId?: string;
}

function hasReadyPhoto(detail: WorkOrderDetail, category: PhotoCategory): boolean {
  return detail.photos.some(
    (photo) => photo.category === category && photo.status === "ready",
  );
}

function itemHasReadyEvidence(detail: WorkOrderDetail, itemId: string): boolean {
  return detail.photos.some(
    (photo) => photo.checklistItemId === itemId && photo.status === "ready",
  );
}

export interface PhotoItemResponse {
  checklistId: string;
  itemId: string;
  photoIds: string[];
}

// Resolve the respond_to_checklist_item payload for a photo-type checklist item
// after evidence upload: the owning checklist id plus the ready photo ids linked
// to the item. Returns null when the item is missing, is not a photo type, or has
// no ready evidence yet — the caller then skips the response write. Kept pure so
// the technician screen stays thin and this stays unit-testable.
export function resolvePhotoItemResponse(
  detail: WorkOrderDetail,
  checklistItemId: string | null,
): PhotoItemResponse | null {
  if (!checklistItemId) return null;
  const owning = detail.checklists.find((checklist) =>
    checklist.items.some((item) => item.id === checklistItemId),
  );
  const item = owning?.items.find((candidate) => candidate.id === checklistItemId);
  if (!owning || item?.responseType !== "photo") return null;

  const photoIds = detail.photos
    .filter((photo) => photo.checklistItemId === checklistItemId && photo.status === "ready")
    .map((photo) => photo.id);
  if (photoIds.length === 0) return null;

  return { checklistId: owning.id, itemId: item.id, photoIds };
}

export function completionBlockers(
  detail: WorkOrderDetail,
  summary: string,
): CompletionBlocker[] {
  const blockers: CompletionBlocker[] = [];
  const items = detail.checklists.flatMap((checklist) => checklist.items);

  for (const item of items) {
    if (!item.isRequired) continue;
    const answered = item.response !== null && item.response !== undefined;
    // A photo-type item is answered by its captured evidence, not by a textual
    // response. Treat a linked ready photo as the answer so the mirror never
    // deadlocks the completion button while the response write settles.
    const satisfiedByEvidence =
      item.responseType === "photo" && itemHasReadyEvidence(detail, item.id);
    if (!answered && !satisfiedByEvidence) {
      blockers.push({
        code: "requiredChecklist",
        message: `檢查項目「${item.label}」尚未填寫`,
        itemId: item.id,
      });
    }
  }

  for (const item of items) {
    if (item.evidenceRequired && !itemHasReadyEvidence(detail, item.id)) {
      blockers.push({
        code: "requiredEvidence",
        message: `檢查項目「${item.label}」需要上傳佐證照片`,
        itemId: item.id,
      });
    }
  }

  if (!hasReadyPhoto(detail, "before")) {
    blockers.push({ code: "beforePhoto", message: "缺少施工前照片" });
  }
  if (!hasReadyPhoto(detail, "after")) {
    blockers.push({ code: "afterPhoto", message: "缺少施工後照片" });
  }
  if (!summary.trim()) {
    blockers.push({ code: "completionSummary", message: "尚未填寫完工摘要" });
  }

  return blockers;
}
