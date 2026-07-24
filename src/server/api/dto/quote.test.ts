import { describe, expect, it } from "vitest";

import { toPublicQuoteDto } from "./quote";

describe("toPublicQuoteDto", () => {
  it("allowlists customer fields and never serializes cost or internal notes", () => {
    const dto = toPublicQuoteDto({
      merchant: { name: "北城工程", phone: "+886223456789" },
      quoteNo: "Q-202607-000123",
      versionNo: 2,
      status: "sent",
      validUntil: "2026-07-25",
      currency: "TWD",
      subtotalMinor: "1800",
      taxMinor: "0",
      totalMinor: "1800",
      customerNotes: "零件另行報價",
      internalNotes: "底價 1200，勿外流",
      items: [
        {
          name: "分離式冷氣清洗",
          unit: "台",
          quantity: "1.000",
          unitPriceMinor: "1800",
          unitCostMinor: "700",
          totalMinor: "1800",
          internalNotes: "熟客可折 100",
        },
      ],
    });

    expect(dto).toMatchObject({ quoteNo: "Q-202607-000123", totalMinor: "1800" });
    expect(JSON.stringify(dto)).not.toContain("unitCostMinor");
    expect(JSON.stringify(dto)).not.toContain("internalNotes");
    expect(JSON.stringify(dto)).not.toContain("底價");
  });
});
