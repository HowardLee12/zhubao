import type { ExtractionInput, ExtractionResult } from "@/schemas/ai-extraction";

// The AI-extractor seam. An extractor turns an aggregated LINE conversation into a
// STRUCTURED DRAFT — never an action. Per the product rule (CLAUDE.md) AI only
// produces drafts; a human confirms every conversion. The worker calls extractIntake
// and hands a successful result to mark_extraction_succeeded; ANY thrown error is
// caught upstream and degraded to a manual draft via mark_extraction_failed, so the
// inbound message is never lost. The real Fireworks HTTP call lives behind this
// interface and is the ONLY deferred real-extractor seam — see FireworksAiExtractor.

export type { ExtractionInput, ExtractionResult } from "@/schemas/ai-extraction";

export interface AiExtractor {
  extractIntake(input: ExtractionInput): Promise<ExtractionResult>;
}

// Fake failure modes. 'ok' returns a deterministic draft; the three failure modes
// all throw so the gateway's try/catch degrades to a manual draft — exercising the
// degradation gate locally with no network and no env.
export type FakeMode = "ok" | "unavailable" | "timeout" | "bad_output";

export interface FakeAiExtractorOptions {
  mode?: FakeMode;
}

// Deterministic in-memory extractor for tests and local runs. It does NOT parse
// natural language — it produces a fixed, schema-valid draft from the input so the
// whole intake flow (aggregate -> extract -> review -> confirm) is exercisable
// without a real model. Every call is recorded for assertion.
export class FakeAiExtractor implements AiExtractor {
  private readonly mode: FakeMode;
  readonly calls: ExtractionInput[] = [];

  constructor(options: FakeAiExtractorOptions = {}) {
    this.mode = options.mode ?? "ok";
  }

  async extractIntake(input: ExtractionInput): Promise<ExtractionResult> {
    this.calls.push(input);

    switch (this.mode) {
      case "unavailable":
        throw new Error("FakeAiExtractor: extractor unavailable (simulated outage).");
      case "timeout":
        throw new Error("FakeAiExtractor: extraction timeout (simulated).");
      case "bad_output":
        // The model returned something that fails the seam contract; surfacing it as
        // a throw makes the gateway degrade exactly as a real malformed response would.
        throw new Error("FakeAiExtractor: bad model output (simulated schema violation).");
      case "ok":
      default:
        return this.buildResult(input);
    }
  }

  // A fixed, plausible draft. The text is passed through verbatim as the summary and
  // description (source='line'), while subject/title are a synthetic AI inference
  // (source='ai') so provenance is visibly mixed for the review UI.
  private buildResult(input: ExtractionInput): ExtractionResult {
    const text = input.conversationText.trim();
    const summary = text.length > 0 ? text.slice(0, 4000) : null;
    const title = text.length > 0 ? "LINE 進件（AI 摘要）" : null;

    return {
      summary,
      title,
      fields: {
        subject: { value: title ?? "LINE 訊息進件", source: "ai", confidence: 0.8 },
        description: { value: summary ?? "", source: "line", confidence: 0.95 },
      },
      missingFields: ["contactPhone", "address"],
      usedMessageIds: [...input.messageIds],
      overallConfidence: 0.82,
    };
  }
}

// DEFERRED REAL-EXTRACTOR SEAM. The interface is complete and this class typechecks
// so the factory and worker can reference it today, but the actual api.fireworks.ai
// call is intentionally NOT implemented — it is wired last, once the user provides
// live Fireworks credentials. Invoking it before that wiring is a programming error
// and throws (mirrors RealLineMessenger).
export class FireworksAiExtractor implements AiExtractor {
  async extractIntake(input: ExtractionInput): Promise<ExtractionResult> {
    // TODO(real-extractor): POST https://api.fireworks.ai/inference/v1/chat/completions
    //   Authorization: Bearer <process.env.FIREWORKS_API_KEY>  (server-only secret;
    //     never sent to the browser)
    //   body: a chat completion whose system prompt constrains the model to return
    //     STRICT JSON matching extractionResultSchema (summary/title/fields with
    //     per-field {value,source,confidence}/missingFields/overallConfidence). Parse
    //     the response with extractionResultSchema.parse — a malformed response must
    //     THROW so the gateway degrades to a manual draft (never a bad persisted draft).
    void input;
    throw new Error(
      "FireworksAiExtractor.extractIntake is not implemented (deferred real-extractor seam).",
    );
  }
}
