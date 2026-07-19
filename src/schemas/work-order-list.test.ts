import { describe, expect, it } from "vitest";

import { scheduleRangeQuerySchema, workOrderListQuerySchema } from "./work-order-list";

describe("workOrderListQuerySchema", () => {
  it("defaults pageSize to 50", () => {
    const parsed = workOrderListQuerySchema.safeParse({});
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.pageSize).toBe(50);
  });

  it("coerces and caps pageSize", () => {
    expect(workOrderListQuerySchema.safeParse({ pageSize: "101" }).success).toBe(false);
    const parsed = workOrderListQuerySchema.safeParse({ pageSize: "10" });
    expect(parsed.success && parsed.data.pageSize).toBe(10);
  });
});

describe("scheduleRangeQuerySchema", () => {
  it("accepts a window within 31 days", () => {
    expect(
      scheduleRangeQuerySchema.safeParse({
        from: "2026-08-01T00:00:00+00:00",
        to: "2026-08-08T00:00:00+00:00",
      }).success,
    ).toBe(true);
  });

  it("rejects an inverted or over-31-day window", () => {
    expect(
      scheduleRangeQuerySchema.safeParse({
        from: "2026-08-08T00:00:00+00:00",
        to: "2026-08-01T00:00:00+00:00",
      }).success,
    ).toBe(false);
    expect(
      scheduleRangeQuerySchema.safeParse({
        from: "2026-08-01T00:00:00+00:00",
        to: "2026-09-15T00:00:00+00:00",
      }).success,
    ).toBe(false);
  });
});
