import { FakeAiExtractor, FireworksAiExtractor, type AiExtractor } from "./extractor";

// Factory: the real Fireworks extractor is only selected when a live extractor is
// explicitly configured (FIREWORKS_AI_LIVE set to a non-blank value). Until then
// everything runs against the deterministic fake, so the whole intake flow is
// exercised locally without any real Fireworks credentials. Mirrors
// createLineMessenger() so the two swappable seams behave identically.
export function createAiExtractor(): AiExtractor {
  if (process.env.FIREWORKS_AI_LIVE?.trim()) {
    return new FireworksAiExtractor();
  }
  return new FakeAiExtractor();
}
