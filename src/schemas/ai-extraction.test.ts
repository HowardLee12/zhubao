import { describe, expect, it } from "vitest";

import { extractionInputSchema, extractionResultSchema } from "./ai-extraction";

const uuid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("extractionInputSchema", () => {
  it("accepts text-only input", () => {
    const parsed = extractionInputSchema.parse({
      conversationText: "冷氣不冷",
      messageIds: [uuid],
    });
    expect(parsed.messageIds).toEqual([uuid]);
  });

  it("accepts image attachment descriptors", () => {
    const parsed = extractionInputSchema.parse({
      conversationText: "",
      attachments: [{ messageId: uuid, kind: "image", storagePath: null }],
      messageIds: [uuid],
    });
    expect(parsed.attachments).toHaveLength(1);
  });
});

describe("extractionResultSchema", () => {
  it("accepts a per-field provenance result", () => {
    const parsed = extractionResultSchema.parse({
      summary: "s",
      title: "t",
      fields: {
        subject: { value: "冷氣", source: "ai", confidence: 0.8 },
        description: { value: "不冷", source: "line", confidence: null },
      },
      missingFields: ["address"],
      usedMessageIds: [uuid],
      overallConfidence: 0.8,
    });
    expect(parsed.fields.subject?.confidence).toBe(0.8);
  });

  it("rejects an out-of-range confidence", () => {
    expect(() =>
      extractionResultSchema.parse({
        summary: null,
        title: null,
        fields: {},
        missingFields: [],
        usedMessageIds: [],
        overallConfidence: 2,
      }),
    ).toThrow();
  });

  it("rejects an unknown field source", () => {
    expect(() =>
      extractionResultSchema.parse({
        summary: null,
        title: null,
        fields: { x: { value: "v", source: "guess", confidence: null } },
        missingFields: [],
        usedMessageIds: [],
        overallConfidence: null,
      }),
    ).toThrow();
  });
});
