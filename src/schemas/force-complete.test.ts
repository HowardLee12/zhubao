import { describe, expect, it } from "vitest";

import { forceCompleteSchema } from "./force-complete";

describe("forceCompleteSchema", () => {
  it("requires reason and completionSummary", () => {
    expect(
      forceCompleteSchema.safeParse({
        reason: "客戶要求提前結案",
        completionSummary: "已完成主要項目",
        occurredAt: "2026-08-01T05:00:00+00:00",
      }).success,
    ).toBe(true);
    expect(
      forceCompleteSchema.safeParse({
        reason: "",
        completionSummary: "x",
        occurredAt: "2026-08-01T05:00:00+00:00",
      }).success,
    ).toBe(false);
  });
});
