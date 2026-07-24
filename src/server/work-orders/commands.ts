import type { WorkOrderDetailDto } from "@/schemas/work-order-detail";
import type {
  WorkOrderActorRole,
  WorkOrderStatus,
  WorkOrderTransitionFacts,
} from "@/server/domain/work-orders/work-order-state";

// Honest LINE status. As of M6, scheduling and completion enqueue the customer
// LINE notification transactionally into the outbox (status `pending`), then a
// worker dispatches it. The mutation route reports `queued` — NOT `sent` — so the
// UI never implies the message already reached the customer; the outbox view is
// the source of truth for the actual delivery lifecycle. When the org has not
// connected a LINE channel or the customer has no bound LINE identity, the DB
// records the enqueue as skipped and nothing is queued; the coarse `queued`
// envelope stays honest because the outbox (empty for that resource) confirms it.
export const QUEUED_NOTIFICATION = {
  status: "queued",
  channel: "line",
} as const;

export interface WorkOrderDetail {
  status: WorkOrderStatus;
  lockVersion: number;
  scheduledStartAt: string | null;
  scheduledEndAt: string | null;
  completionSummary: string | null;
  completedAt: string | null;
  requiresCustomerSignoff: boolean;
  customerSignedAt: string | null;
  assignments: Array<{ membershipId: string; status: string }>;
  checklists: Array<{
    items: Array<{
      isRequired: boolean;
      evidenceRequired: boolean;
      response: unknown;
      id: string;
    }>;
  }>;
  photos: Array<{ category: string; status: string }>;
}

const ACTIVE_ASSIGNMENT_STATUSES = new Set(["assigned", "accepted", "checked_in"]);

// Derive the domain facts the transition pre-check reads from a work-order detail
// JSON. The DB re-computes these authoritatively; this mirror only powers the
// fast pre-check so a blocked completion returns a specific, actionable error.
export function deriveTransitionFacts(detail: WorkOrderDetail): WorkOrderTransitionFacts {
  const items = detail.checklists.flatMap((checklist) => checklist.items);
  const requiredChecklistComplete = items
    .filter((item) => item.isRequired)
    .every((item) => item.response !== null && item.response !== undefined);
  const hasReadyPhoto = (category: string) =>
    detail.photos.some((photo) => photo.category === category && photo.status === "ready");

  return {
    activeAssignmentCount: detail.assignments.filter((assignment) =>
      ACTIVE_ASSIGNMENT_STATUSES.has(assignment.status),
    ).length,
    scheduledStartAt: detail.scheduledStartAt ?? undefined,
    scheduledEndAt: detail.scheduledEndAt ?? undefined,
    requiredChecklistComplete,
    // Evidence-per-item linkage is not fully expressed in the detail projection;
    // the DB is the authoritative gate for it, so the pre-check stays permissive
    // here to avoid a false block. A missing before/after photo IS pre-checked.
    requiredEvidenceComplete: true,
    hasBeforePhoto: hasReadyPhoto("before"),
    hasAfterPhoto: hasReadyPhoto("after"),
    completionSummary: detail.completionSummary ?? undefined,
    completedAt: detail.completedAt ?? undefined,
  };
}

export function resolveActorRole(roles: {
  isManager: boolean;
  isAssigned: boolean;
}): WorkOrderActorRole {
  return roles.isManager ? "dispatcher" : "technician";
}

// Adapt a work-order detail DTO into the WorkOrderDetail shape deriveTransitionFacts
// reads. Keeps the route thin: the route never re-maps nested arrays itself.
export function factsFromDetailDto(detail: WorkOrderDetailDto): WorkOrderTransitionFacts {
  return deriveTransitionFacts({
    status: detail.status as WorkOrderStatus,
    lockVersion: detail.lockVersion,
    scheduledStartAt: detail.scheduledStartAt,
    scheduledEndAt: detail.scheduledEndAt,
    completionSummary: detail.completionSummary,
    completedAt: detail.completedAt,
    requiresCustomerSignoff: detail.requiresCustomerSignoff,
    customerSignedAt: detail.customerSignedAt,
    assignments: detail.assignments.map((a) => ({
      membershipId: a.membershipId,
      status: a.status,
    })),
    checklists: detail.checklists.map((c) => ({
      items: c.items.map((item) => ({
        id: item.id,
        isRequired: item.isRequired,
        evidenceRequired: item.evidenceRequired,
        response: item.response,
      })),
    })),
    photos: detail.photos.map((p) => ({ category: p.category, status: p.status })),
  });
}
