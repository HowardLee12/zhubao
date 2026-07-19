import { describe, expect, it } from "vitest";

import { checklistCreateSchema, checklistItemRespondSchema } from "./work-order-checklist";

describe("checklistCreateSchema", () => {
  it("accepts a checklist with items", () => {
    expect(
      checklistCreateSchema.safeParse({
        name: "冷氣清洗檢查",
        items: [{ label: "檢查排水", responseType: "boolean", isRequired: true }],
      }).success,
    ).toBe(true);
  });

  it("requires at least one item and caps at 200", () => {
    expect(checklistCreateSchema.safeParse({ name: "x", items: [] }).success).toBe(false);
  });

  it("rejects an unknown response type", () => {
    expect(
      checklistCreateSchema.safeParse({
        name: "x",
        items: [{ label: "a", responseType: "signature" }],
      }).success,
    ).toBe(false);
  });
});

describe("checklistItemRespondSchema", () => {
  it("accepts any non-null JSON value", () => {
    expect(checklistItemRespondSchema.safeParse({ response: true }).success).toBe(true);
    expect(checklistItemRespondSchema.safeParse({ response: ["a", "b"] }).success).toBe(true);
  });

  it("rejects a null response", () => {
    expect(checklistItemRespondSchema.safeParse({ response: null }).success).toBe(false);
  });
});
