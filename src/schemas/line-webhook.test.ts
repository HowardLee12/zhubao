import { describe, expect, it } from "vitest";

import { lineWebhookBodySchema, lineWebhookEventSchema } from "./line-webhook";

describe("lineWebhookEventSchema", () => {
  it("accepts a follow event with a webhookEventId", () => {
    expect(
      lineWebhookEventSchema.safeParse({
        type: "follow",
        timestamp: 1_700_000_000_000,
        webhookEventId: "01H000000000000000000000",
        source: { type: "user", userId: "Uabc" },
      }).success,
    ).toBe(true);
  });

  it("accepts a redelivery event without a webhookEventId", () => {
    expect(
      lineWebhookEventSchema.safeParse({ type: "message", timestamp: 1_700_000_000_000 }).success,
    ).toBe(true);
  });

  it("preserves unknown fields (loose) so the raw payload is not truncated", () => {
    const parsed = lineWebhookEventSchema.safeParse({
      type: "message",
      timestamp: 1_700_000_000_000,
      message: { type: "text", text: "漏水" },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect((parsed.data as Record<string, unknown>).message).toEqual({
        type: "text",
        text: "漏水",
      });
    }
  });

  it("rejects a negative timestamp", () => {
    expect(lineWebhookEventSchema.safeParse({ type: "message", timestamp: -1 }).success).toBe(false);
  });

  it("rejects a missing type", () => {
    expect(lineWebhookEventSchema.safeParse({ timestamp: 1 }).success).toBe(false);
  });
});

describe("lineWebhookBodySchema", () => {
  it("accepts an empty-events verify ping", () => {
    expect(
      lineWebhookBodySchema.safeParse({ destination: "Ubotuser", events: [] }).success,
    ).toBe(true);
  });

  it("rejects a missing destination", () => {
    expect(lineWebhookBodySchema.safeParse({ events: [] }).success).toBe(false);
  });

  it("caps events at 100", () => {
    const events = Array.from({ length: 101 }, () => ({ type: "message", timestamp: 1 }));
    expect(lineWebhookBodySchema.safeParse({ destination: "Ubot", events }).success).toBe(false);
  });
});
