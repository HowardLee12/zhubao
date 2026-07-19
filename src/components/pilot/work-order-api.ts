import {
  ensureCsrfToken,
  createIdempotencyKey,
  PilotApiError,
  sha256File,
} from "./api";

/**
 * M5 work-order client helpers (dispatcher scheduling + technician field ops).
 *
 * The server owns every authoritative shape — these types mirror the Wave B
 * route DTOs (the `toClientWorkOrderDetail` projection, the assignment DTO, the
 * list projection and the photo/checklist result shapes). Mutations are
 * cookie-authenticated and carry the double-submit `X-CSRF-Token` header;
 * optimistic-concurrency mutations additionally send `If-Match: "{lockVersion}"`.
 *
 * A 412 (stale If-Match) is surfaced as a typed {@link PilotApiError} so callers
 * can refetch the current detail and retry with a fresh ETag rather than
 * silently clobbering a concurrent edit.
 */

const JSON_HEADERS = {
  Accept: "application/json",
  "Content-Type": "application/json",
} as const;

interface ProblemDetails {
  title?: string;
  detail?: string;
  conflicts?: ScheduleConflict[];
}

export interface ScheduleConflict {
  membershipId: string;
  workOrderId: string;
  workOrderNo: string;
  startsAt: string | null;
  endsAt: string | null;
}

/**
 * Raised when a schedule mutation is rejected because a candidate technician is
 * already booked in the requested window. Carries the top-level `conflicts[]`
 * the schedule-conflict problem body surfaces so the UI can name who clashes.
 */
export class ScheduleConflictError extends PilotApiError {
  readonly conflicts: ScheduleConflict[];

  constructor(message: string, conflicts: ScheduleConflict[]) {
    super(message, 409);
    this.name = "ScheduleConflictError";
    this.conflicts = conflicts;
  }
}

async function readData<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => null)) as
    | { data: T }
    | ProblemDetails
    | null;

  if (!response.ok) {
    throw problemToError(body as ProblemDetails | null, response.status);
  }

  return (body as { data: T }).data;
}

async function readEnvelope<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => null)) as T | ProblemDetails | null;

  if (!response.ok) {
    throw problemToError(body as ProblemDetails | null, response.status);
  }

  return body as T;
}

function problemToError(problem: ProblemDetails | null, status: number): PilotApiError {
  const message =
    problem?.detail ?? problem?.title ?? "服務暫時無法使用，請稍後再試。";
  if (status === 409 && Array.isArray(problem?.conflicts)) {
    return new ScheduleConflictError(message, problem.conflicts);
  }
  return new PilotApiError(message, status);
}

function ifMatch(lockVersion: number): string {
  return `"${lockVersion}"`;
}

function orgPath(organizationId: string): string {
  return `/api/v2/organizations/${encodeURIComponent(organizationId)}`;
}

function mutationHeaders(lockVersion?: number, idempotencyKey?: string): HeadersInit {
  const headers: Record<string, string> = {
    ...JSON_HEADERS,
    "X-CSRF-Token": ensureCsrfToken(),
  };
  if (typeof lockVersion === "number") headers["If-Match"] = ifMatch(lockVersion);
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  return headers;
}

// ---------------------------------------------------------------------------
// DTOs — these mirror the server projections exactly (do not drift).
// ---------------------------------------------------------------------------

export type WorkOrderStatus =
  | "draft"
  | "scheduled"
  | "dispatched"
  | "en_route"
  | "on_site"
  | "paused"
  | "completed"
  | "cancelled";

export type WorkOrderPriority = "low" | "normal" | "high" | "urgent";

export type AssignmentDuty = "lead" | "technician" | "helper" | "observer";

export type PhotoCategory =
  | "intake"
  | "before"
  | "after"
  | "issue"
  | "receipt"
  | "signature"
  | "other";

export interface WorkOrderListItem {
  id: string;
  workOrderNo: string;
  title: string;
  status: WorkOrderStatus;
  priority: WorkOrderPriority;
  customerId: string;
  projectId: string | null;
  assetId: string | null;
  scheduledStartAt: string | null;
  scheduledEndAt: string | null;
  completedAt: string | null;
  lockVersion: number;
  createdAt: string;
  updatedAt: string;
  assigneeCount: number;
}

export interface WorkOrderAssignment {
  id: string;
  membershipId: string;
  memberName: string | null;
  duty: string;
  status: string;
  assignedAt: string | null;
  acceptedAt: string | null;
  declinedAt: string | null;
  checkedInAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  declineReason: string | null;
  lockVersion: number;
}

export interface ChecklistItem {
  id: string;
  label: string;
  responseType: string;
  isRequired: boolean;
  evidenceRequired: boolean;
  options: unknown;
  response: unknown;
  completedAt: string | null;
  completedByMembershipId: string | null;
  sortOrder: number;
}

export interface WorkOrderChecklist {
  id: string;
  name: string;
  status: string;
  completedAt: string | null;
  completedByMembershipId: string | null;
  lockVersion: number;
  items: ChecklistItem[];
}

export interface WorkOrderPhoto {
  id: string;
  category: PhotoCategory;
  status: string;
  checklistItemId: string | null;
  storagePath: string;
  mimeType: string;
  byteSize: number | null;
  width: number | null;
  height: number | null;
  sha256: string | null;
  caption: string | null;
  capturedAt: string | null;
  uploadedByMembershipId: string | null;
  readyAt: string | null;
  lockVersion: number;
  createdAt: string;
}

export interface WorkOrderDetail {
  id: string;
  organizationId: string;
  workOrderNo: string;
  projectId: string | null;
  serviceRequestId: string | null;
  customerId: string;
  locationId: string;
  assetId: string | null;
  title: string;
  description: string | null;
  customerNotes: string | null;
  technicianNotes: string | null;
  internalNotes: string | null;
  completionSummary: string | null;
  priority: WorkOrderPriority;
  status: WorkOrderStatus;
  scheduledStartAt: string | null;
  scheduledEndAt: string | null;
  dispatchedAt: string | null;
  enRouteAt: string | null;
  onSiteAt: string | null;
  pausedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
  requiresCustomerSignoff: boolean;
  customerSignedAt: string | null;
  lockVersion: number;
  createdAt: string;
  updatedAt: string;
  assignments: WorkOrderAssignment[];
  checklists: WorkOrderChecklist[];
  photos: WorkOrderPhoto[];
}

export interface NotificationStatus {
  status: string;
  reason: string;
}

export interface WorkOrderListPage {
  data: WorkOrderListItem[];
  meta: { hasMore: boolean; nextCursor: string | null };
}

export type WorkOrderTransitionAction =
  | "dispatch"
  | "enRoute"
  | "arrive"
  | "pause"
  | "resume"
  | "complete"
  | "cancel"
  | "reopen";

export interface ScheduleAssignmentInput {
  membershipId: string;
  duty?: AssignmentDuty;
}

export interface ScheduleWorkOrderInput {
  scheduledStartAt: string;
  scheduledEndAt: string;
  occurredAt: string;
  assignments: ScheduleAssignmentInput[];
  conflictOverrideReason?: string | null;
}

export interface WorkOrderCreateInput {
  customerId: string;
  locationId: string;
  title: string;
  projectId?: string | null;
  assetId?: string | null;
  serviceRequestId?: string | null;
  description?: string;
  customerNotes?: string;
  internalNotes?: string;
  priority?: WorkOrderPriority;
}

export interface PhotoUploadInstruction {
  photoId: string;
  upload: {
    method: "PUT";
    url: string;
    headers: Record<string, string>;
    expiresAt: string;
  };
}

export interface PhotoReadUrl {
  photoId: string;
  url: string;
  expiresAt: string;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface ListWorkOrdersOptions {
  status?: string;
  assigneeId?: string;
  cursor?: string | null;
  pageSize?: number;
}

export async function listWorkOrders(
  organizationId: string,
  options: ListWorkOrdersOptions = {},
): Promise<WorkOrderListPage> {
  const params = new URLSearchParams();
  if (options.status) params.set("status", options.status);
  if (options.assigneeId) params.set("assigneeId", options.assigneeId);
  if (options.cursor) params.set("cursor", options.cursor);
  if (options.pageSize) params.set("pageSize", String(options.pageSize));

  const query = params.toString();
  const suffix = query ? `?${query}` : "";
  const response = await fetch(`${orgPath(organizationId)}/work-orders${suffix}`, {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  return readEnvelope<WorkOrderListPage>(response);
}

export async function fetchScheduleWindow(
  organizationId: string,
  from: string,
  to: string,
): Promise<WorkOrderListItem[]> {
  const params = new URLSearchParams({ from, to });
  const response = await fetch(
    `${orgPath(organizationId)}/schedule?${params.toString()}`,
    { method: "GET", headers: { Accept: "application/json" } },
  );
  return readData<WorkOrderListItem[]>(response);
}

export async function fetchWorkOrderDetail(
  organizationId: string,
  workOrderId: string,
): Promise<WorkOrderDetail> {
  const response = await fetch(
    `${orgPath(organizationId)}/work-orders/${encodeURIComponent(workOrderId)}`,
    { method: "GET", headers: { Accept: "application/json" } },
  );
  return readData<WorkOrderDetail>(response);
}

// ---------------------------------------------------------------------------
// Work-order mutations
// ---------------------------------------------------------------------------

export async function createWorkOrder(
  organizationId: string,
  idempotencyKey: string,
  input: WorkOrderCreateInput,
): Promise<WorkOrderDetail> {
  const response = await fetch(`${orgPath(organizationId)}/work-orders`, {
    method: "POST",
    headers: mutationHeaders(undefined, idempotencyKey),
    body: JSON.stringify(input),
  });
  return readData<WorkOrderDetail>(response);
}

export async function scheduleWorkOrder(
  organizationId: string,
  workOrderId: string,
  lockVersion: number,
  input: ScheduleWorkOrderInput,
): Promise<{ data: WorkOrderDetail; notification: NotificationStatus }> {
  const response = await fetch(
    `${orgPath(organizationId)}/work-orders/${encodeURIComponent(workOrderId)}/actions/schedule`,
    {
      method: "POST",
      headers: mutationHeaders(lockVersion, createIdempotencyKey()),
      body: JSON.stringify(input),
    },
  );
  return readEnvelope<{ data: WorkOrderDetail; notification: NotificationStatus }>(response);
}

export interface TransitionOptions {
  occurredAt?: string;
  reason?: string;
  completionSummary?: string;
  overrideReason?: string | null;
}

export async function transitionWorkOrder(
  organizationId: string,
  workOrderId: string,
  lockVersion: number,
  action: WorkOrderTransitionAction,
  options: TransitionOptions = {},
): Promise<{ data: { lockVersion?: number; status?: string }; notification: NotificationStatus }> {
  const body: Record<string, unknown> = {
    action,
    occurredAt: options.occurredAt ?? new Date().toISOString(),
  };
  if (action === "cancel" || action === "reopen") body.reason = options.reason;
  if (action === "complete") body.completionSummary = options.completionSummary;
  if (options.overrideReason) body.overrideReason = options.overrideReason;

  const response = await fetch(
    `${orgPath(organizationId)}/work-orders/${encodeURIComponent(workOrderId)}/actions/transition`,
    {
      method: "POST",
      headers: mutationHeaders(lockVersion, createIdempotencyKey()),
      body: JSON.stringify(body),
    },
  );
  return readEnvelope<{
    data: { lockVersion?: number; status?: string };
    notification: NotificationStatus;
  }>(response);
}

export interface ForceCompleteInput {
  reason: string;
  completionSummary: string;
  occurredAt?: string;
}

export async function forceCompleteWorkOrder(
  organizationId: string,
  workOrderId: string,
  lockVersion: number,
  input: ForceCompleteInput,
): Promise<{ data: WorkOrderDetail; notification: NotificationStatus }> {
  const response = await fetch(
    `${orgPath(organizationId)}/work-orders/${encodeURIComponent(workOrderId)}/actions/force-complete`,
    {
      method: "POST",
      headers: mutationHeaders(lockVersion, createIdempotencyKey()),
      body: JSON.stringify({
        reason: input.reason,
        completionSummary: input.completionSummary,
        occurredAt: input.occurredAt ?? new Date().toISOString(),
      }),
    },
  );
  return readEnvelope<{ data: WorkOrderDetail; notification: NotificationStatus }>(response);
}

// ---------------------------------------------------------------------------
// Assignments
// ---------------------------------------------------------------------------

export async function respondToAssignment(
  organizationId: string,
  assignmentId: string,
  lockVersion: number,
  decision: "accept" | "decline",
  reason?: string,
): Promise<WorkOrderAssignment> {
  const body: Record<string, unknown> =
    decision === "decline" ? { decision, reason } : { decision };
  const response = await fetch(
    `${orgPath(organizationId)}/assignments/${encodeURIComponent(assignmentId)}/actions/respond`,
    {
      method: "POST",
      headers: mutationHeaders(lockVersion, createIdempotencyKey()),
      body: JSON.stringify(body),
    },
  );
  return readData<WorkOrderAssignment>(response);
}

// ---------------------------------------------------------------------------
// Schedule conflict probe
// ---------------------------------------------------------------------------

export interface ScheduleConflictProbeInput {
  membershipIds: string[];
  startsAt: string;
  endsAt: string;
  excludeWorkOrderId?: string | null;
}

export async function checkScheduleConflicts(
  organizationId: string,
  input: ScheduleConflictProbeInput,
): Promise<ScheduleConflict[]> {
  const response = await fetch(
    `${orgPath(organizationId)}/schedule/conflict-check`,
    {
      method: "POST",
      headers: mutationHeaders(),
      body: JSON.stringify(input),
    },
  );
  const result = await readData<{ conflicts: ScheduleConflict[] }>(response);
  return result.conflicts;
}

// ---------------------------------------------------------------------------
// Checklist
// ---------------------------------------------------------------------------

export async function respondToChecklistItem(
  organizationId: string,
  checklistId: string,
  itemId: string,
  workOrderLockVersion: number,
  response: unknown,
): Promise<{ id: string; workOrderId: string; response: unknown; lockVersion: number }> {
  const httpResponse = await fetch(
    `${orgPath(organizationId)}/work-order-checklists/${encodeURIComponent(
      checklistId,
    )}/items/${encodeURIComponent(itemId)}`,
    {
      method: "PATCH",
      headers: mutationHeaders(workOrderLockVersion),
      body: JSON.stringify({ response }),
    },
  );
  return readData(httpResponse);
}

export async function completeChecklist(
  organizationId: string,
  checklistId: string,
  workOrderLockVersion: number,
): Promise<{ checklistId: string; workOrderId: string; status: string; completedAt: string }> {
  const response = await fetch(
    `${orgPath(organizationId)}/work-order-checklists/${encodeURIComponent(
      checklistId,
    )}/actions/complete`,
    {
      method: "POST",
      headers: mutationHeaders(workOrderLockVersion),
    },
  );
  return readData(response);
}

// ---------------------------------------------------------------------------
// Photos — reserve, upload to signed PUT, verify-and-mark-ready
// ---------------------------------------------------------------------------

export interface PhotoUploadRequest {
  category: PhotoCategory;
  filename: string;
  contentType: "image/jpeg" | "image/png" | "image/webp";
  byteSize: number;
  sha256: string;
  checklistItemId?: string | null;
  caption?: string;
  capturedAt?: string | null;
}

export async function reservePhotoUpload(
  organizationId: string,
  workOrderId: string,
  input: PhotoUploadRequest,
): Promise<PhotoUploadInstruction> {
  const response = await fetch(
    `${orgPath(organizationId)}/work-orders/${encodeURIComponent(workOrderId)}/photo-uploads`,
    {
      method: "POST",
      headers: mutationHeaders(),
      body: JSON.stringify(input),
    },
  );
  return readData<PhotoUploadInstruction>(response);
}

export async function uploadPhotoBytes(
  instruction: PhotoUploadInstruction["upload"],
  file: File,
): Promise<void> {
  const uploadBody = new FormData();
  uploadBody.append("cacheControl", "3600");
  uploadBody.append("", file);

  const response = await fetch(instruction.url, {
    method: instruction.method,
    headers: instruction.headers,
    body: uploadBody,
  });

  if (!response.ok) {
    throw new PilotApiError("照片上傳失敗，請檢查網路後再試。", response.status);
  }
}

export async function completePhotoUpload(
  organizationId: string,
  photoId: string,
): Promise<{ photoId: string; status: string; category: string }> {
  const response = await fetch(
    `${orgPath(organizationId)}/photos/${encodeURIComponent(photoId)}/complete`,
    {
      method: "POST",
      headers: mutationHeaders(),
    },
  );
  return readData(response);
}

export async function fetchPhotoReadUrl(
  organizationId: string,
  photoId: string,
): Promise<PhotoReadUrl> {
  const response = await fetch(
    `${orgPath(organizationId)}/photos/${encodeURIComponent(photoId)}`,
    { method: "GET", headers: { Accept: "application/json" } },
  );
  return readData<PhotoReadUrl>(response);
}

/**
 * Full photo capture flow reused by the technician field screen: fingerprint the
 * file, reserve a pending row, PUT the bytes to the signed URL, then trigger the
 * server-side verify-and-mark-ready. The sha256 fingerprint is returned so the
 * caller can de-duplicate re-uploads of the identical file (mirrors the public
 * intake dedupe cache).
 */
export async function captureWorkOrderPhoto(
  organizationId: string,
  workOrderId: string,
  file: File,
  category: PhotoCategory,
  options: { checklistItemId?: string | null; caption?: string } = {},
): Promise<{ photoId: string; sha256: string }> {
  const contentType = file.type;
  if (
    contentType !== "image/jpeg" &&
    contentType !== "image/png" &&
    contentType !== "image/webp"
  ) {
    throw new PilotApiError("只支援 JPG、PNG 或 WebP 照片。", 422);
  }

  const sha256 = await sha256File(file);
  const instruction = await reservePhotoUpload(organizationId, workOrderId, {
    category,
    filename: file.name,
    contentType,
    byteSize: file.size,
    sha256,
    checklistItemId: options.checklistItemId ?? null,
    caption: options.caption,
    capturedAt: new Date(file.lastModified).toISOString(),
  });
  await uploadPhotoBytes(instruction.upload, file);
  await completePhotoUpload(organizationId, instruction.photoId);
  return { photoId: instruction.photoId, sha256 };
}

export { createIdempotencyKey, PilotApiError };
