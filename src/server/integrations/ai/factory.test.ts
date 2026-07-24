import { afterEach, describe, expect, it } from "vitest";

import { createAiExtractor } from "./factory";
import { FakeAiExtractor, FireworksAiExtractor } from "./extractor";

const ORIGINAL = process.env.FIREWORKS_AI_LIVE;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.FIREWORKS_AI_LIVE;
  else process.env.FIREWORKS_AI_LIVE = ORIGINAL;
});

describe("createAiExtractor", () => {
  it("returns the Fake extractor when FIREWORKS_AI_LIVE is unset", () => {
    delete process.env.FIREWORKS_AI_LIVE;
    expect(createAiExtractor()).toBeInstanceOf(FakeAiExtractor);
  });

  it("returns the Fake extractor when FIREWORKS_AI_LIVE is blank", () => {
    process.env.FIREWORKS_AI_LIVE = "   ";
    expect(createAiExtractor()).toBeInstanceOf(FakeAiExtractor);
  });

  it("selects the deferred Fireworks extractor only when explicitly enabled", () => {
    process.env.FIREWORKS_AI_LIVE = "1";
    expect(createAiExtractor()).toBeInstanceOf(FireworksAiExtractor);
  });
});
