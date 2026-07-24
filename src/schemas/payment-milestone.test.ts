import { describe, expect, it } from "vitest";

import {
  createPaymentMilestoneSchema,
  listPaymentMilestonesQuerySchema,
  markPaymentMilestonePaidSchema,
  waivePaymentMilestoneSchema,
} from "./payment-milestone";

describe("payment-milestone schemas", () => {
  it("accepts a positive integer minor-unit amount", () => {
    const parsed = createPaymentMilestoneSchema.parse({
      projectId: "11111111-1111-4111-8111-111111111111",
      name: "訂金",
      amountMinor: 5000,
    });
    expect(parsed.amountMinor).toBe(5000);
  });

  it("rejects a non-integer or non-positive amount", () => {
    const base = {
      projectId: "11111111-1111-4111-8111-111111111111",
      name: "訂金",
    };
    expect(createPaymentMilestoneSchema.safeParse({ ...base, amountMinor: 0 }).success).toBe(false);
    expect(createPaymentMilestoneSchema.safeParse({ ...base, amountMinor: 12.5 }).success).toBe(
      false,
    );
    expect(createPaymentMilestoneSchema.safeParse({ ...base, amountMinor: -1 }).success).toBe(false);
  });

  it("rejects unknown keys (strict)", () => {
    expect(
      createPaymentMilestoneSchema.safeParse({
        projectId: "11111111-1111-4111-8111-111111111111",
        name: "訂金",
        amountMinor: 5000,
        gatewayToken: "tok_x",
      }).success,
    ).toBe(false);
  });

  it("mark-paid accepts a small tracking surface", () => {
    const parsed = markPaymentMilestonePaidSchema.parse({ paymentMethod: "cash" });
    expect(parsed.paymentMethod).toBe("cash");
  });

  it("waive requires a non-empty reason", () => {
    expect(waivePaymentMilestoneSchema.safeParse({ reason: "" }).success).toBe(false);
    expect(waivePaymentMilestoneSchema.safeParse({ reason: "客戶取消" }).success).toBe(true);
  });

  it("list query coerces limit and validates status enum", () => {
    const parsed = listPaymentMilestonesQuerySchema.parse({ limit: "25", status: "overdue" });
    expect(parsed.limit).toBe(25);
    expect(listPaymentMilestonesQuerySchema.safeParse({ status: "bogus" }).success).toBe(false);
  });
});
