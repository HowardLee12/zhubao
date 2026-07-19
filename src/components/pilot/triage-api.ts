import { ensureCsrfToken, PilotApiError } from "./api";

/**
 * M3 staff triage/convert client helpers.
 *
 * Every mutation is cookie-authenticated and therefore carries the double-submit
 * `X-CSRF-Token` header (see {@link ensureCsrfToken}). Optimistic-concurrency
 * mutations additionally send `If-Match: "{lockVersion}"`; convert also sends an
 * `Idempotency-Key`. The server owns the authoritative shapes — these types
 * mirror the Wave A RPC contracts and the OpenAPI DTOs the routes surface.
 */

const JSON_HEADERS = {
  Accept: "application/json",
  "Content-Type": "application/json",
} as const;

interface ProblemDetails {
  title?: string;
  detail?: string;
}

async function readData<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => null)) as
    | { data: T }
    | ProblemDetails
    | null;

  if (!response.ok) {
    const problem = body as ProblemDetails | null;
    throw new PilotApiError(
      problem?.detail ?? problem?.title ?? "服務暫時無法使用，請稍後再試。",
      response.status,
    );
  }

  return (body as { data: T }).data;
}

async function readEnvelope<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => null)) as T | ProblemDetails | null;

  if (!response.ok) {
    const problem = body as ProblemDetails | null;
    throw new PilotApiError(
      problem?.detail ?? problem?.title ?? "服務暫時無法使用，請稍後再試。",
      response.status,
    );
  }

  return body as T;
}

function ifMatch(lockVersion: number): string {
  return `"${lockVersion}"`;
}

function orgPath(organizationId: string): string {
  return `/api/v2/organizations/${encodeURIComponent(organizationId)}`;
}

export type ServiceRequestStatus =
  | "new"
  | "triaged"
  | "quoting"
  | "quoted"
  | "converted"
  | "declined"
  | "cancelled";

export type ServiceRequestPriority = "low" | "normal" | "high" | "urgent";

export interface PreferredWindow {
  startsAt: string;
  endsAt: string;
  preferenceRank: number;
}

/**
 * Immutable snapshot captured when the public intake was submitted. Rendered
 * read-only on the left of the detail screen; the triage summary edit path never
 * writes back into it (a DB guard trigger enforces this server-side too).
 */
export interface OriginalSubmission {
  contactName?: string;
  contactPhone?: string | null;
  contactEmail?: string | null;
  subject?: string;
  description?: string;
  source?: string;
  submittedAt?: string;
  [key: string]: unknown;
}

export interface RequestPhoto {
  id: string;
  category: string;
  url: string;
  expiresAt: string;
}

/**
 * Detail DTO the staff detail screen consumes. It is a superset of the
 * OpenAPI `ServiceRequest` read DTO — B1 owns the route and mapper; the
 * original/summary/context extras (originalSubmission, summaryEditedBy(Name),
 * summaryEditedAt, serviceName, address) are what the M3 detail screen needs.
 */
export interface ServiceRequestDetail {
  id: string;
  requestNo: string;
  customerId: string | null;
  locationId: string | null;
  assetId: string | null;
  source: string;
  status: ServiceRequestStatus;
  priority: ServiceRequestPriority;
  category: string | null;
  subject: string;
  title: string;
  description: string;
  contactName: string;
  contactPhone: string | null;
  contactEmail: string | null;
  assignedMemberId: string | null;
  internalNote: string;
  preferredWindows: PreferredWindow[];
  originalSubmission: OriginalSubmission | null;
  summaryEditedBy: string | null;
  summaryEditedAt: string | null;
  triagedAt: string | null;
  convertedAt: string | null;
  convertedProjectId: string | null;
  convertedWorkOrderId: string | null;
  convertedProjectNo: string | null;
  convertedWorkOrderNo: string | null;
  declineReason: string | null;
  cancellationReason: string | null;
  photos: RequestPhoto[];
  lockVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface OrganizationMember {
  id: string;
  displayName: string;
  role: string;
  status: "invited" | "active" | "suspended" | "removed";
}

export interface SimilarCustomer {
  customerId: string;
  customerNo: string;
  name: string;
  phone: string | null;
  matchReason: "phone" | "name";
}

export interface CustomerRecord {
  id: string;
  customerNo: string;
  kind: "individual" | "company";
  name: string;
  phone: string | null;
  email: string | null;
  companyName: string | null;
  source: string;
  notes: string;
  lastContactAt: string | null;
  lockVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerLocation {
  id: string;
  customerId: string;
  label: string;
  contactName: string | null;
  contactPhone: string | null;
  postalCode: string | null;
  county: string | null;
  district: string | null;
  addressLine: string;
  accessNotes: string;
  isDefault: boolean;
  lockVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerAsset {
  id: string;
  customerId: string;
  locationId: string;
  assetNo: string;
  assetType: string;
  name: string;
  brand: string | null;
  model: string | null;
  serialNumber: string | null;
  installedOn: string | null;
  status: string;
  lockVersion: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Compact result the status-only mutations return. The triage / decline / cancel
 * routes reply with the server's ActionResult projection (not the full detail
 * DTO), so the detail screen must MERGE these fields onto the currently loaded
 * detail rather than replace it — replacing would blank content columns the
 * ActionResult omits (subject, description, requestNo, originalSubmission, …).
 */
export interface ServiceRequestActionResult {
  id: string;
  status: ServiceRequestStatus;
  priority: ServiceRequestPriority;
  category: string | null;
  customerId: string | null;
  locationId: string | null;
  assetId: string | null;
  assignedMemberId: string | null;
  triagedAt: string | null;
  convertedAt: string | null;
  convertedProjectId: string | null;
  convertedWorkOrderId: string | null;
  lockVersion: number;
  updatedAt: string;
}

export interface ConversionResult {
  serviceRequest: {
    id: string;
    status: ServiceRequestStatus;
    lockVersion: number;
    convertedAt: string;
  };
  project: { id: string; projectNo: string; name: string; status: string } | null;
  workOrder: { id: string; workOrderNo: string; title: string; status: string } | null;
  replayed: boolean;
}

export interface PatchSummaryInput {
  subject: string;
  description: string;
  contactName: string;
  contactPhone: string | null;
  category?: string | null;
  priority?: ServiceRequestPriority;
}

export interface TriageInput {
  customerId: string;
  locationId?: string | null;
  assetId?: string | null;
  assignedMemberId?: string | null;
  priority?: ServiceRequestPriority;
  category?: string | null;
  internalNote?: string | null;
}

export type ConvertMode = "singleVisit" | "project";

export interface ConvertInput {
  mode: ConvertMode;
  projectTitle?: string;
  workOrder?: {
    title: string;
    scheduledStartAt?: string | null;
    scheduledEndAt?: string | null;
  };
}

export async function fetchServiceRequestDetail(
  organizationId: string,
  requestId: string,
): Promise<ServiceRequestDetail> {
  const response = await fetch(
    `${orgPath(organizationId)}/service-requests/${encodeURIComponent(requestId)}`,
    { method: "GET", headers: { Accept: "application/json" } },
  );
  return readData<ServiceRequestDetail>(response);
}

export async function patchServiceRequestSummary(
  organizationId: string,
  requestId: string,
  lockVersion: number,
  input: PatchSummaryInput,
): Promise<ServiceRequestDetail> {
  const response = await fetch(
    `${orgPath(organizationId)}/service-requests/${encodeURIComponent(requestId)}`,
    {
      method: "PATCH",
      headers: {
        ...JSON_HEADERS,
        "If-Match": ifMatch(lockVersion),
        "X-CSRF-Token": ensureCsrfToken(),
      },
      body: JSON.stringify(input),
    },
  );
  return readData<ServiceRequestDetail>(response);
}

export async function triageServiceRequest(
  organizationId: string,
  requestId: string,
  lockVersion: number,
  input: TriageInput,
): Promise<ServiceRequestActionResult> {
  const response = await fetch(
    `${orgPath(organizationId)}/service-requests/${encodeURIComponent(requestId)}/actions/triage`,
    {
      method: "POST",
      headers: {
        ...JSON_HEADERS,
        "If-Match": ifMatch(lockVersion),
        "X-CSRF-Token": ensureCsrfToken(),
      },
      body: JSON.stringify(input),
    },
  );
  return readData<ServiceRequestActionResult>(response);
}

export async function convertServiceRequest(
  organizationId: string,
  requestId: string,
  lockVersion: number,
  idempotencyKey: string,
  input: ConvertInput,
): Promise<ConversionResult> {
  const response = await fetch(
    `${orgPath(organizationId)}/service-requests/${encodeURIComponent(requestId)}/actions/convert`,
    {
      method: "POST",
      headers: {
        ...JSON_HEADERS,
        "If-Match": ifMatch(lockVersion),
        "Idempotency-Key": idempotencyKey,
        "X-CSRF-Token": ensureCsrfToken(),
      },
      body: JSON.stringify(input),
    },
  );
  // The convert route wraps the ConversionEnvelope in the standard { data }
  // envelope (HTTP 201), like every other mutation — unwrap it here.
  return readData<ConversionResult>(response);
}

export async function declineServiceRequest(
  organizationId: string,
  requestId: string,
  lockVersion: number,
  reason: string,
): Promise<ServiceRequestActionResult> {
  const response = await fetch(
    `${orgPath(organizationId)}/service-requests/${encodeURIComponent(requestId)}/actions/decline`,
    {
      method: "POST",
      headers: {
        ...JSON_HEADERS,
        "If-Match": ifMatch(lockVersion),
        "X-CSRF-Token": ensureCsrfToken(),
      },
      body: JSON.stringify({ reason }),
    },
  );
  return readData<ServiceRequestActionResult>(response);
}

export async function cancelServiceRequest(
  organizationId: string,
  requestId: string,
  lockVersion: number,
  reason: string,
): Promise<ServiceRequestActionResult> {
  const response = await fetch(
    `${orgPath(organizationId)}/service-requests/${encodeURIComponent(requestId)}/actions/cancel`,
    {
      method: "POST",
      headers: {
        ...JSON_HEADERS,
        "If-Match": ifMatch(lockVersion),
        "X-CSRF-Token": ensureCsrfToken(),
      },
      body: JSON.stringify({ reason }),
    },
  );
  return readData<ServiceRequestActionResult>(response);
}

export async function fetchSimilarCustomers(
  organizationId: string,
  criteria: { phone?: string | null; name?: string | null },
): Promise<SimilarCustomer[]> {
  const params = new URLSearchParams();
  if (criteria.phone) params.set("phone", criteria.phone);
  if (criteria.name) params.set("name", criteria.name);
  if (params.toString() === "") return [];

  const response = await fetch(
    `${orgPath(organizationId)}/customers/similar?${params.toString()}`,
    { method: "GET", headers: { Accept: "application/json" } },
  );
  const envelope = await readEnvelope<{ data: SimilarCustomer[] }>(response);
  return envelope.data;
}

export async function createCustomer(
  organizationId: string,
  input: { name: string; phone: string | null },
): Promise<CustomerRecord> {
  const response = await fetch(`${orgPath(organizationId)}/customers`, {
    method: "POST",
    headers: {
      ...JSON_HEADERS,
      "X-CSRF-Token": ensureCsrfToken(),
    },
    body: JSON.stringify(input),
  });
  return readData<CustomerRecord>(response);
}

export async function fetchCustomerLocations(
  organizationId: string,
  customerId: string,
): Promise<CustomerLocation[]> {
  const response = await fetch(
    `${orgPath(organizationId)}/customers/${encodeURIComponent(customerId)}/locations`,
    { method: "GET", headers: { Accept: "application/json" } },
  );
  const envelope = await readEnvelope<{ data: CustomerLocation[] }>(response);
  return envelope.data;
}

export async function fetchCustomerAssets(
  organizationId: string,
  customerId: string,
): Promise<CustomerAsset[]> {
  const response = await fetch(
    `${orgPath(organizationId)}/customers/${encodeURIComponent(customerId)}/assets`,
    { method: "GET", headers: { Accept: "application/json" } },
  );
  const envelope = await readEnvelope<{ data: CustomerAsset[] }>(response);
  return envelope.data;
}

export async function fetchOrganizationMembers(
  organizationId: string,
): Promise<OrganizationMember[]> {
  const response = await fetch(`${orgPath(organizationId)}/members`, {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  const envelope = await readEnvelope<{ data: OrganizationMember[] }>(response);
  return envelope.data;
}
