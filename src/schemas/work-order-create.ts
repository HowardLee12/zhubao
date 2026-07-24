import { z } from "zod";

// Request body for POST .../work-orders (dispatcher manual creation, non-convert
// path). The Idempotency-Key arrives in a header, not the body. The payload is a
// strict allowlist mirroring create_work_order's server-side validation so a
// field the RPC would reject never reaches the database.
export const workOrderCreateSchema = z
  .object({
    customerId: z.uuid(),
    locationId: z.uuid(),
    title: z.string().trim().min(1).max(160),
    projectId: z.uuid().nullable().optional(),
    assetId: z.uuid().nullable().optional(),
    serviceRequestId: z.uuid().nullable().optional(),
    serviceCatalogItemId: z.uuid().nullable().optional(),
    description: z.string().max(10_000).optional(),
    customerNotes: z.string().max(10_000).optional(),
    internalNotes: z.string().max(10_000).optional(),
    priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
  })
  .strict();

export type WorkOrderCreateInput = z.infer<typeof workOrderCreateSchema>;
