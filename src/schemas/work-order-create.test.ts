import { describe, expect, it } from "vitest";

import { workOrderCreateSchema } from "./work-order-create";

const base = {
  customerId: "40000000-0000-4000-8000-000000000001",
  locationId: "50000000-0000-4000-8000-000000000001",
  title: "冷氣清洗",
};

describe("workOrderCreateSchema", () => {
  it("accepts the minimal required payload", () => {
    expect(workOrderCreateSchema.safeParse(base).success).toBe(true);
  });

  it("rejects unknown fields", () => {
    expect(workOrderCreateSchema.safeParse({ ...base, status: "draft" }).success).toBe(false);
  });

  it("rejects an empty or oversized title", () => {
    expect(workOrderCreateSchema.safeParse({ ...base, title: "" }).success).toBe(false);
    expect(workOrderCreateSchema.safeParse({ ...base, title: "x".repeat(161) }).success).toBe(false);
  });

  it("rejects an invalid priority", () => {
    expect(workOrderCreateSchema.safeParse({ ...base, priority: "later" }).success).toBe(false);
  });
});
