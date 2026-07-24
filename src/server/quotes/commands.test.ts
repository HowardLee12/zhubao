import { describe, expect, it } from "vitest";

import type { QuoteDraftInput } from "@/schemas/quote";

import { calculateValidatedQuoteDraft } from "./commands";

function draft(overrides: Partial<QuoteDraftInput["items"][number]> = {}): QuoteDraftInput {
  return {
    title: "正式報價",
    validUntil: null,
    customerNotes: "",
    internalNotes: "",
    terms: "",
    items: [
      {
        serviceCatalogItemId: null,
        groupName: "服務",
        name: "清洗",
        specification: "",
        unit: "台",
        quantity: "2.000",
        unitCostMinor: "1000",
        unitPriceMinor: "2500",
        discountMinor: "0",
        taxRate: "0.0500",
        sortOrder: 10,
        ...overrides,
      },
    ],
  };
}

describe("calculateValidatedQuoteDraft", () => {
  it("returns server-calculated totals", () => {
    expect(calculateValidatedQuoteDraft(draft())).toMatchObject({ totalMinor: "5250" });
  });

  it("maps an excessive discount to a specific safe validation problem", () => {
    expect(() =>
      calculateValidatedQuoteDraft(draft({ unitPriceMinor: "100", discountMinor: "201" })),
    ).toThrow(
      expect.objectContaining({
        status: 422,
        code: "DISCOUNT_EXCEEDS_SUBTOTAL",
        detail: "折扣不可大於該品項小計。",
      }),
    );
  });

  it("maps other calculation failures without reflecting raw values", () => {
    expect(() => calculateValidatedQuoteDraft(draft({ quantity: "not-a-number" }))).toThrow(
      expect.objectContaining({
        status: 422,
        code: "INVALID_QUANTITY",
        detail: "請檢查品項數量、單價、折扣與稅率。",
      }),
    );
  });
});
