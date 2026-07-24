import { describe, expect, it } from "vitest";

import {
  funnelReportSchema,
  operationsReportSchema,
  retentionReportSchema,
} from "./report";

const window = { from: "2026-06-01", to: "2026-06-30", timezone: "Asia/Taipei" };

describe("report schemas", () => {
  it("funnel parses the five stages", () => {
    const parsed = funnelReportSchema.parse({
      window,
      stages: { intake: 5, triaged: 4, quoted: 3, converted: 2, completed: 1 },
    });
    expect(parsed.stages.completed).toBe(1);
  });

  it("operations omits amounts when includeAmounts is false", () => {
    const parsed = operationsReportSchema.parse({
      window,
      workOrders: { scheduled: 1, inProgress: 0, completed: 2, cancelled: 0 },
      payments: { pending: 1, invoiced: 1, overdue: 0, paid: 3 },
      includeAmounts: false,
    });
    expect(parsed.includeAmounts).toBe(false);
    expect(parsed.payments.outstandingAmountMinor).toBeUndefined();
  });

  it("operations carries the outstanding amount when included", () => {
    const parsed = operationsReportSchema.parse({
      window,
      workOrders: { scheduled: 1, inProgress: 0, completed: 2, cancelled: 0 },
      payments: { pending: 1, invoiced: 1, overdue: 0, paid: 3, outstandingAmountMinor: 12000 },
      includeAmounts: true,
    });
    expect(parsed.payments.outstandingAmountMinor).toBe(12000);
  });

  it("retention parses the counts", () => {
    const parsed = retentionReportSchema.parse({
      window,
      activePlans: 4,
      remindersSent: 3,
      revisitRequests: 1,
    });
    expect(parsed.revisitRequests).toBe(1);
  });
});
