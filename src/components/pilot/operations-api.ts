import { createIdempotencyKey, ensureCsrfToken, PilotApiError } from "./api";

// ---------------------------------------------------------------------------
// M8 operations client helpers: payments, maintenance/follow-ups, asset history,
// dashboard KPIs, and owner-gated data deletion. Every shape mirrors the REAL
// Wave B route DTOs (envelope {data}), and every mutation carries the
// double-submit CSRF token; state actions add If-Match (ETag = "lockVersion")
// and an Idempotency-Key. Technician DTOs never carry amounts/cost/KPI — that is
// enforced by the RPC (includeAmounts=false / 403), not the client.
// ---------------------------------------------------------------------------

interface ProblemDetails {
  title?: string;
  detail?: string;
}

async function readJson<T>(response: Response): Promise<T> {
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

function orgPath(organizationId: string): string {
  return `/api/v2/organizations/${encodeURIComponent(organizationId)}`;
}

function ifMatch(lockVersion: number): string {
  return `"${lockVersion}"`;
}

// --- Payments -------------------------------------------------------------

export type PaymentMilestoneStatus =
  | "pending"
  | "invoiced"
  | "overdue"
  | "paid"
  | "waived"
  | "cancelled";

export interface PaymentMilestone {
  id: string;
  organizationId: string;
  projectId: string;
  quoteVersionId: string | null;
  changeOrderId: string | null;
  name: string;
  sequenceNo: number;
  status: PaymentMilestoneStatus;
  dueOn: string | null;
  invoicedAt: string | null;
  paidAt: string | null;
  waivedAt: string | null;
  cancelledAt: string | null;
  paymentMethod: string | null;
  externalReference: string | null;
  notes: string | null;
  lockVersion: number;
  createdAt: string;
  updatedAt: string;
  timezone: string;
  // Present only when includeAmounts is true (financial roles). The technician
  // DTO omits both — the UI must treat undefined as "not visible".
  amountMinor?: number;
  currency?: string;
}

export interface PaymentMilestoneList {
  milestones: PaymentMilestone[];
  includeAmounts: boolean;
}

export interface CreatePaymentMilestoneInput {
  projectId: string;
  name: string;
  amountMinor: number;
  dueOn?: string | null;
}

export async function fetchPaymentMilestones(
  organizationId: string,
  options: { projectId?: string | null; status?: PaymentMilestoneStatus | null; limit?: number } = {},
): Promise<PaymentMilestoneList> {
  const params = new URLSearchParams();
  if (options.projectId) params.set("projectId", options.projectId);
  if (options.status) params.set("status", options.status);
  params.set("limit", String(options.limit ?? 100));

  const response = await fetch(`${orgPath(organizationId)}/payment-milestones?${params.toString()}`, {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  const envelope = await readJson<{ data: PaymentMilestoneList }>(response);
  return envelope.data;
}

export async function createPaymentMilestone(
  organizationId: string,
  input: CreatePaymentMilestoneInput,
): Promise<PaymentMilestone> {
  const response = await fetch(`${orgPath(organizationId)}/payment-milestones`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "Idempotency-Key": createIdempotencyKey(),
      "X-CSRF-Token": ensureCsrfToken(),
    },
    body: JSON.stringify(input),
  });
  const envelope = await readJson<{ data: PaymentMilestone }>(response);
  return envelope.data;
}

async function paymentAction(
  organizationId: string,
  milestoneId: string,
  action: "invoice" | "mark-paid" | "waive" | "cancel" | "reverse-payment",
  lockVersion: number,
  body: Record<string, unknown>,
): Promise<PaymentMilestone> {
  const response = await fetch(
    `${orgPath(organizationId)}/payment-milestones/${encodeURIComponent(milestoneId)}/actions/${action}`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "If-Match": ifMatch(lockVersion),
        "Idempotency-Key": createIdempotencyKey(),
        "X-CSRF-Token": ensureCsrfToken(),
      },
      body: JSON.stringify(body),
    },
  );
  const envelope = await readJson<{ data: PaymentMilestone }>(response);
  return envelope.data;
}

export function invoicePaymentMilestone(
  organizationId: string,
  milestoneId: string,
  lockVersion: number,
  dueOn?: string | null,
): Promise<PaymentMilestone> {
  return paymentAction(organizationId, milestoneId, "invoice", lockVersion, dueOn ? { dueOn } : {});
}

export function markPaymentMilestonePaid(
  organizationId: string,
  milestoneId: string,
  lockVersion: number,
  input: { paymentMethod?: string; externalReference?: string } = {},
): Promise<PaymentMilestone> {
  return paymentAction(organizationId, milestoneId, "mark-paid", lockVersion, input);
}

export function waivePaymentMilestone(
  organizationId: string,
  milestoneId: string,
  lockVersion: number,
  reason: string,
): Promise<PaymentMilestone> {
  return paymentAction(organizationId, milestoneId, "waive", lockVersion, { reason });
}

export function reversePaymentMilestone(
  organizationId: string,
  milestoneId: string,
  lockVersion: number,
  reason: string,
): Promise<PaymentMilestone> {
  return paymentAction(organizationId, milestoneId, "reverse-payment", lockVersion, { reason });
}

// --- Maintenance / follow-ups --------------------------------------------

export type MaintenancePlanStatus = "active" | "paused" | "completed" | "cancelled";

export interface MaintenancePlan {
  id: string;
  organizationId: string;
  customerId: string;
  locationId: string;
  assetId: string | null;
  serviceCatalogItemId: string | null;
  name: string;
  cadenceMonths: number;
  leadDays: number;
  nextDueOn: string;
  lastCompletedWorkOrderId: string | null;
  status: MaintenancePlanStatus;
  autoPrepareMessage: boolean;
  pausedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  lockVersion: number;
  createdAt: string;
  updatedAt: string;
}

export async function fetchMaintenancePlans(
  organizationId: string,
  options: { status?: MaintenancePlanStatus | null; limit?: number } = {},
): Promise<MaintenancePlan[]> {
  const params = new URLSearchParams();
  if (options.status) params.set("status", options.status);
  params.set("limit", String(options.limit ?? 100));

  const response = await fetch(`${orgPath(organizationId)}/maintenance-plans?${params.toString()}`, {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  const envelope = await readJson<{ data: { plans: MaintenancePlan[] } }>(response);
  return envelope.data.plans;
}

export interface PrepareRemindersResult {
  prepared: number;
  skipped: number;
}

// Prepares an approval-pending reminder draft per plan; it never auto-sends.
export async function prepareMaintenanceReminders(
  organizationId: string,
  planIds: string[],
): Promise<PrepareRemindersResult> {
  const response = await fetch(
    `${orgPath(organizationId)}/maintenance-reminders/actions/prepare`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "Idempotency-Key": createIdempotencyKey(),
        "X-CSRF-Token": ensureCsrfToken(),
      },
      body: JSON.stringify({ planIds }),
    },
  );
  const envelope = await readJson<{ data: PrepareRemindersResult }>(response);
  return envelope.data;
}

export interface ConvertPlanResult {
  serviceRequestId: string;
  requestNo?: string;
  replayed: boolean;
}

// One-click revisit -> new service_request (source=revisit, origin linkage, no
// copied photos). force=false -> 409 when the asset already has an open request.
export async function convertMaintenancePlan(
  organizationId: string,
  planId: string,
  lockVersion: number,
  input: { subject?: string; force?: boolean } = {},
): Promise<ConvertPlanResult> {
  const response = await fetch(
    `${orgPath(organizationId)}/maintenance-plans/${encodeURIComponent(planId)}/actions/convert`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "If-Match": ifMatch(lockVersion),
        "Idempotency-Key": createIdempotencyKey(),
        "X-CSRF-Token": ensureCsrfToken(),
      },
      body: JSON.stringify(input),
    },
  );
  const envelope = await readJson<{ data: ConvertPlanResult }>(response);
  return envelope.data;
}

// --- Asset history --------------------------------------------------------

export interface AssetDetail {
  id: string;
  organizationId: string;
  customerId: string;
  locationId: string;
  assetNo: string;
  assetType: string;
  name: string;
  brand: string | null;
  model: string | null;
  serialNumber: string | null;
  installedOn: string | null;
  warrantyExpiresOn: string | null;
  lastServicedAt: string | null;
  status: string;
  attributes: Record<string, unknown> | null;
  lockVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface AssetHistoryEvent {
  eventType: string;
  occurredAt: string;
  payload: Record<string, unknown>;
  chainSequence: number;
}

export interface AssetHistoryWorkOrder {
  workOrderId: string;
  workOrderNo: string;
  status: string;
  scheduledStartAt: string | null;
  completedAt: string | null;
}

export interface AssetHistory {
  asset: AssetDetail;
  events: AssetHistoryEvent[];
  workOrders: AssetHistoryWorkOrder[];
}

export async function fetchAssetHistory(
  organizationId: string,
  assetId: string,
): Promise<AssetHistory> {
  const response = await fetch(
    `${orgPath(organizationId)}/assets/${encodeURIComponent(assetId)}/history`,
    { method: "GET", headers: { Accept: "application/json" } },
  );
  const envelope = await readJson<{ data: AssetHistory }>(response);
  return envelope.data;
}

// --- Dashboard KPIs -------------------------------------------------------

export interface KpiWindow {
  from: string;
  to: string;
  timezone: string;
}

export interface Kpi {
  available: boolean;
  numerator: number | null;
  denominator: number | null;
  window: KpiWindow;
  timezone: string;
  [key: string]: unknown;
}

export interface DashboardResult {
  window: KpiWindow;
  metrics: {
    firstResponseTime: Kpi;
    quoteAcceptanceRate: Kpi;
    completionRate: Kpi;
    revisitRate: Kpi;
  };
}

export async function fetchDashboard(
  organizationId: string,
  options: { from?: string; to?: string } = {},
): Promise<DashboardResult> {
  const params = new URLSearchParams();
  if (options.from) params.set("from", options.from);
  if (options.to) params.set("to", options.to);
  const query = params.toString();
  const response = await fetch(
    `${orgPath(organizationId)}/dashboard${query ? `?${query}` : ""}`,
    { method: "GET", headers: { Accept: "application/json" } },
  );
  const envelope = await readJson<{ data: DashboardResult }>(response);
  return envelope.data;
}

// --- Owner data deletion --------------------------------------------------

export interface DataDeletionRequested {
  deletionRequestId: string;
  status: string;
}

export interface DataDeletionFinalized {
  status: string;
  anonymizedCustomers?: number;
  replayed?: boolean;
}

export async function requestDataDeletion(
  organizationId: string,
  reauthToken: string,
): Promise<DataDeletionRequested> {
  const response = await fetch(`${orgPath(organizationId)}/data-deletion/actions/request`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-CSRF-Token": ensureCsrfToken(),
    },
    body: JSON.stringify({ reauthToken }),
  });
  const envelope = await readJson<{ data: DataDeletionRequested }>(response);
  return envelope.data;
}

export async function finalizeDataDeletion(
  organizationId: string,
  deletionRequestId: string,
  reauthToken: string,
): Promise<DataDeletionFinalized> {
  const response = await fetch(`${orgPath(organizationId)}/data-deletion/actions/finalize`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-CSRF-Token": ensureCsrfToken(),
    },
    body: JSON.stringify({ deletionRequestId, reauthToken }),
  });
  const envelope = await readJson<{ data: DataDeletionFinalized }>(response);
  return envelope.data;
}
