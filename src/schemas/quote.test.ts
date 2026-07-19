import { describe, expect, it } from "vitest";

import {
  createQuoteSchema,
  moneyMinorSchema,
  publicQuoteResponseSchema,
  quantitySchema,
  quoteDraftSchema,
  taxRateSchema,
} from "./quote";

const item = {
  serviceCatalogItemId: null,
  groupName: "清洗",
  name: "分離式冷氣清洗",
  specification: "含基本排水測試",
  unit: "台",
  quantity: "2.000",
  unitCostMinor: "700",
  unitPriceMinor: "1800",
  discountMinor: "0",
  taxRate: "0.0500",
  sortOrder: 10,
};

describe("quote input contracts", () => {
  it("accepts a complete custom quote draft without trusting client totals", () => {
    const parsed = createQuoteSchema.parse({
      serviceRequestId: "80000000-0000-4000-8000-000000000001",
      customerId: "40000000-0000-4000-8000-000000000001",
      locationId: "50000000-0000-4000-8000-000000000001",
      currency: "TWD",
      version: {
        title: "冷氣清洗報價",
        validUntil: "2026-07-31",
        customerNotes: "現場異常另行確認",
        internalNotes: "成本僅店內可見",
        terms: "完工付款",
        items: [item],
      },
    });

    expect(parsed.version.items[0]?.unitPriceMinor).toBe("1800");
    expect(parsed.version).not.toHaveProperty("totalMinor");
  });

  it("rejects totals and other unknown fields instead of silently accepting them", () => {
    expect(() =>
      quoteDraftSchema.parse({
        title: "測試",
        validUntil: null,
        customerNotes: "",
        internalNotes: "",
        terms: "",
        items: [item],
        totalMinor: "1",
      }),
    ).toThrow();
  });

  it.each(["0", "-1", "1.0001", "1e3", "NaN"])("rejects invalid quantity %s", (value) => {
    expect(quantitySchema.safeParse(value).success).toBe(false);
  });

  it.each(["-1", "1.5", "9223372036854775808", "1e3"])("rejects invalid money %s", (value) => {
    expect(moneyMinorSchema.safeParse(value).success).toBe(false);
  });

  it.each(["-0.1", "1.0001", "5", "0.12345"])("rejects invalid tax rate %s", (value) => {
    expect(taxRateSchema.safeParse(value).success).toBe(false);
  });

  it("requires a named customer decision without accepting an internal version UUID", () => {
    const valid = {
      decision: "accept",
      displayName: "王先生",
      comment: "請安排週六上午",
    };

    expect(publicQuoteResponseSchema.safeParse(valid).success).toBe(true);
    expect(
      publicQuoteResponseSchema.safeParse({
        ...valid,
        versionId: "85100000-0000-4000-8000-000000000002",
      }).success,
    ).toBe(false);
    expect(
      publicQuoteResponseSchema.safeParse({ ...valid, unitCostMinor: "700" }).success,
    ).toBe(false);
  });
});
