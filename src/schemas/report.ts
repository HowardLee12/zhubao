import { z } from "zod";

const windowSchema = z.object({
  from: z.string(),
  to: z.string(),
  timezone: z.string(),
});

export const funnelReportSchema = z
  .object({
    window: windowSchema,
    stages: z.object({
      intake: z.number().int(),
      triaged: z.number().int(),
      quoted: z.number().int(),
      converted: z.number().int(),
      completed: z.number().int(),
    }),
  })
  .strict();

export type FunnelReport = z.infer<typeof funnelReportSchema>;

// report_operations returns current-state snapshots. Amount fields (outstanding)
// are present only when includeAmounts is true — the RPC redacts them for roles
// without cost visibility, and the technician surface never calls this report.
export const operationsReportSchema = z
  .object({
    window: windowSchema,
    workOrders: z.object({
      scheduled: z.number().int(),
      inProgress: z.number().int(),
      completed: z.number().int(),
      cancelled: z.number().int(),
    }),
    payments: z
      .object({
        pending: z.number().int(),
        invoiced: z.number().int(),
        overdue: z.number().int(),
        paid: z.number().int(),
        outstandingAmountMinor: z.number().int().optional(),
      })
      .loose(),
    includeAmounts: z.boolean(),
  })
  .strict();

export type OperationsReport = z.infer<typeof operationsReportSchema>;

export const retentionReportSchema = z
  .object({
    window: windowSchema,
    activePlans: z.number().int(),
    remindersSent: z.number().int(),
    revisitRequests: z.number().int(),
  })
  .strict();

export type RetentionReport = z.infer<typeof retentionReportSchema>;
