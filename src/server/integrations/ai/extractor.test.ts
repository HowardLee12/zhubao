import { describe, expect, it } from "vitest";

import { extractionResultSchema } from "@/schemas/ai-extraction";
import { FakeAiExtractor, FireworksAiExtractor } from "./extractor";

const messageId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const otherId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function input(overrides: Record<string, unknown> = {}) {
  return {
    conversationText: "冷氣不冷，想約週六來看，地址台北市大安區",
    messageIds: [messageId, otherId],
    ...overrides,
  };
}

describe("FakeAiExtractor", () => {
  it("ok mode returns a deterministic, schema-valid result echoing usedMessageIds", async () => {
    const extractor = new FakeAiExtractor({ mode: "ok" });

    const first = await extractor.extractIntake(input());
    const second = await extractor.extractIntake(input());

    // Deterministic: same input -> byte-identical output.
    expect(second).toEqual(first);
    // Validates against the seam contract.
    expect(() => extractionResultSchema.parse(first)).not.toThrow();
    // Echoes the message ids it read so the run audit is exact.
    expect(first.usedMessageIds).toEqual([messageId, otherId]);
    expect(first.overallConfidence).toBeGreaterThan(0);
    expect(first.fields.subject?.source).toBe("ai");
  });

  it("records every call for assertion", async () => {
    const extractor = new FakeAiExtractor({ mode: "ok" });
    await extractor.extractIntake(input());
    await extractor.extractIntake(input({ conversationText: "another" }));

    expect(extractor.calls).toHaveLength(2);
    expect(extractor.calls[1]?.conversationText).toBe("another");
  });

  it("unavailable mode throws so the gateway degrades to a manual draft", async () => {
    const extractor = new FakeAiExtractor({ mode: "unavailable" });
    await expect(extractor.extractIntake(input())).rejects.toThrow(/unavailable/i);
    // The failed attempt is still recorded.
    expect(extractor.calls).toHaveLength(1);
  });

  it("timeout mode throws", async () => {
    const extractor = new FakeAiExtractor({ mode: "timeout" });
    await expect(extractor.extractIntake(input())).rejects.toThrow(/timeout/i);
  });

  it("bad_output mode throws (malformed model response) so it degrades too", async () => {
    const extractor = new FakeAiExtractor({ mode: "bad_output" });
    await expect(extractor.extractIntake(input())).rejects.toThrow();
  });

  it("defaults to ok mode", async () => {
    const extractor = new FakeAiExtractor();
    const result = await extractor.extractIntake(input());
    expect(() => extractionResultSchema.parse(result)).not.toThrow();
  });
});

describe("FireworksAiExtractor (deferred real seam)", () => {
  it("throws because the real Fireworks call is not wired yet", async () => {
    const extractor = new FireworksAiExtractor();
    await expect(extractor.extractIntake(input())).rejects.toThrow(/not implemented/i);
  });
});
