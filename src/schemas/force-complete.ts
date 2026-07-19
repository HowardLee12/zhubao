import { z } from "zod";

// POST .../work-orders/:id/actions/force-complete — owner/admin exception
// completion. The If-Match header carries the expected work-order lock version.
// Both reason and completionSummary are mandatory; the RPC re-enforces the owner
// gate and records a distinct work_order.force_completed audit event.
export const forceCompleteSchema = z
  .object({
    reason: z.string().trim().min(1).max(2_000),
    completionSummary: z.string().trim().min(1).max(10_000),
    occurredAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export type ForceCompleteInput = z.infer<typeof forceCompleteSchema>;
