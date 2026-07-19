import { z } from "zod";

const workOrderStatus = z.enum([
  "draft",
  "scheduled",
  "dispatched",
  "en_route",
  "on_site",
  "paused",
  "completed",
  "cancelled",
]);

// Query params for GET .../work-orders. Keyset cursor is (createdAt,id) DESC and
// is carried as an opaque encoded string; the route decodes it into the two RPC
// cursor params. Technicians see only their own assignments (enforced in the RPC).
export const workOrderListQuerySchema = z
  .object({
    status: workOrderStatus.optional(),
    assigneeId: z.uuid().optional(),
    projectId: z.uuid().optional(),
    customerId: z.uuid().optional(),
    assetId: z.uuid().optional(),
    priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
    scheduledFrom: z.iso.datetime({ offset: true }).optional(),
    scheduledTo: z.iso.datetime({ offset: true }).optional(),
    q: z.string().trim().min(1).max(120).optional(),
    pageSize: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.string().min(1).max(1024).optional(),
  })
  .strict();

export type WorkOrderListQuery = z.infer<typeof workOrderListQuerySchema>;

// GET .../schedule query: a bounded window (<=31 days), from/to required.
export const scheduleRangeQuerySchema = z
  .object({
    from: z.iso.datetime({ offset: true }),
    to: z.iso.datetime({ offset: true }),
  })
  .strict()
  .refine(
    (value) => {
      const from = Date.parse(value.from);
      const to = Date.parse(value.to);
      const thirtyOneDaysMs = 31 * 24 * 60 * 60 * 1000;
      return Number.isFinite(from) && Number.isFinite(to) && to > from && to - from <= thirtyOneDaysMs;
    },
    { message: "查詢區間必須為 1 到 31 天。" },
  );

export type ScheduleRangeQuery = z.infer<typeof scheduleRangeQuerySchema>;
