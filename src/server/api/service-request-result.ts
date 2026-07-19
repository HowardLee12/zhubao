import { z } from "zod";

// Compact action result returned by the triage/start-quoting/mark-quoted/decline/
// cancel routes. The underlying RPCs return the full public.service_requests
// rowtype (snake_case); this maps only the fields the UI needs to refresh its
// optimistic state after a mutation. Internal columns are never surfaced.
const actionResultRowSchema = z
  .object({
    id: z.uuid(),
    status: z.enum([
      "new",
      "triaged",
      "quoting",
      "quoted",
      "converted",
      "declined",
      "cancelled",
    ]),
    priority: z.enum(["low", "normal", "high", "urgent"]),
    category: z.string().min(1).max(100).nullable(),
    customer_id: z.uuid().nullable(),
    location_id: z.uuid().nullable(),
    asset_id: z.uuid().nullable(),
    assigned_member_id: z.uuid().nullable(),
    triaged_at: z.iso.datetime({ offset: true }).nullable(),
    converted_at: z.iso.datetime({ offset: true }).nullable(),
    converted_project_id: z.uuid().nullable(),
    converted_work_order_id: z.uuid().nullable(),
    lock_version: z.number().int().min(1),
    updated_at: z.iso.datetime({ offset: true }),
  })
  .passthrough();

export interface ServiceRequestActionResult {
  id: string;
  status: string;
  priority: string;
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

export function toActionResult(data: unknown): ServiceRequestActionResult | null {
  const parsed = actionResultRowSchema.safeParse(data);
  if (!parsed.success) return null;
  const row = parsed.data;
  return {
    id: row.id,
    status: row.status,
    priority: row.priority,
    category: row.category,
    customerId: row.customer_id,
    locationId: row.location_id,
    assetId: row.asset_id,
    assignedMemberId: row.assigned_member_id,
    triagedAt: row.triaged_at,
    convertedAt: row.converted_at,
    convertedProjectId: row.converted_project_id,
    convertedWorkOrderId: row.converted_work_order_id,
    lockVersion: row.lock_version,
    updatedAt: row.updated_at,
  };
}
