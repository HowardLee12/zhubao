import { z } from "zod";

// Request body for POST .../service-requests/:id/actions/triage. The optimistic
// lock version arrives in the If-Match header (not the body). customerId is
// mandatory because the triage RPC rejects a null customer with
// TRIAGE_REQUIRES_CUSTOMER; location/asset/assignee are optional bindings and
// may be nulled to clear a prior provisional link. priority/category are
// optional overrides that coalesce at the DB layer (null keeps the existing
// value). priority/category accept null as well as absent — both map to "keep
// existing" at the RPC (p_* ?? null → coalesce), so the client may send an
// explicit null for an un-set select without a validation error.
const prioritySchema = z.enum(["low", "normal", "high", "urgent"]);

export const triageRequestSchema = z
  .object({
    customerId: z.uuid(),
    locationId: z.uuid().nullable().optional(),
    assetId: z.uuid().nullable().optional(),
    assignedMemberId: z.uuid().nullable().optional(),
    priority: prioritySchema.nullable().optional(),
    category: z.string().min(1).max(100).nullable().optional(),
    internalNote: z.string().max(2000).nullable().optional(),
  })
  .strict();

export type TriageRequest = z.infer<typeof triageRequestSchema>;
