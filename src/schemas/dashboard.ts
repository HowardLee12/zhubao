import { z } from "zod";

// The dashboard/report windows are inclusive org-local date ranges bounded to
// 366 days. Both bounds are optional; the RPC defaults to the last 30 days.
export const dateWindowQuerySchema = z
  .object({
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
  })
  .strict();

export type DateWindowQuery = z.infer<typeof dateWindowQuerySchema>;

// Every KPI carries its numerator/denominator/window/timezone so the UI can show
// an honest "尚無足夠資料" (available=false) instead of a misleading 0%.
const kpiSchema = z
  .object({
    available: z.boolean(),
    numerator: z.number().nullable(),
    denominator: z.number().nullable(),
    window: z.object({ from: z.string(), to: z.string(), timezone: z.string() }),
    timezone: z.string(),
  })
  .loose();

export const dashboardResultSchema = z
  .object({
    window: z.object({ from: z.string(), to: z.string(), timezone: z.string() }),
    metrics: z.object({
      firstResponseTime: kpiSchema,
      quoteAcceptanceRate: kpiSchema,
      completionRate: kpiSchema,
      revisitRate: kpiSchema,
    }),
  })
  .strict();

export type DashboardResult = z.infer<typeof dashboardResultSchema>;
