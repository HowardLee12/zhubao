import { describe, expect, it } from "vitest";

import { dashboardResultSchema, dateWindowQuerySchema } from "./dashboard";

describe("dashboard schemas", () => {
  it("window query accepts optional bounds and rejects unknown keys", () => {
    expect(dateWindowQuerySchema.safeParse({}).success).toBe(true);
    expect(dateWindowQuerySchema.safeParse({ from: "2026-06-01", to: "2026-06-30" }).success).toBe(
      true,
    );
    expect(dateWindowQuerySchema.safeParse({ orgId: "x" }).success).toBe(false);
  });

  it("result parses the four KPI blocks with numerator/denominator/window/timezone", () => {
    const window = { from: "2026-06-01", to: "2026-06-30", timezone: "Asia/Taipei" };
    const kpi = { available: true, numerator: 3, denominator: 5, window, timezone: "Asia/Taipei" };
    const parsed = dashboardResultSchema.parse({
      window,
      metrics: {
        firstResponseTime: { ...kpi, medianSeconds: 120, p90Seconds: 300 },
        quoteAcceptanceRate: kpi,
        completionRate: kpi,
        revisitRate: { available: false, numerator: null, denominator: null, window, timezone: "Asia/Taipei" },
      },
    });
    expect(parsed.metrics.revisitRate.available).toBe(false);
  });
});
