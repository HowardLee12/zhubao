import { describe, expect, it, vi } from "vitest";

import { FakeAiExtractor } from "@/server/integrations/ai/extractor";
import { runClaimedExtractions } from "./gateway";

const CONV = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ORG = "20000000-0000-4000-8000-000000000001";
const CHANNEL = "a1c00000-0000-4000-8000-000000000001";
const MSG = "11111111-1111-4111-8111-111111111111";

function claim(over: Record<string, unknown> = {}) {
  return {
    conversationId: CONV,
    organizationId: ORG,
    lineChannelId: CHANNEL,
    lineUserId: "Uabc",
    customerLineIdentityId: null,
    messageCount: 1,
    claimedBy: "w",
    messages: [{ id: MSG, messageType: "text", textContent: "冷氣不冷", sentAt: null }],
    ...over,
  };
}

// A minimal rpc stub that records every call and returns the shapes the real RPCs do.
function makeRpc(claims: unknown[]) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    calls.push({ name, args });
    if (name === "claim_intake_extraction_runs") return { data: claims, error: null };
    if (name === "mark_extraction_succeeded")
      return { data: { runId: "r", draftId: "d", origin: "ai", draftStatus: "pending_review" }, error: null };
    if (name === "mark_extraction_failed")
      return { data: { runId: "r", draftId: "d", origin: "manual", draftStatus: "pending_review" }, error: null };
    return { data: null, error: { message: `no handler ${name}` } };
  });
  return { supabase: { rpc } as never, calls };
}

describe("runClaimedExtractions", () => {
  it("success: writes an AI draft via mark_extraction_succeeded with fields + confidence", async () => {
    const { supabase, calls } = makeRpc([claim()]);
    const extractor = new FakeAiExtractor({ mode: "ok" });

    const summary = await runClaimedExtractions({ supabase, extractor, workerId: "w", limit: 10 });

    expect(summary).toEqual({ claimed: 1, succeeded: 1, degraded: 0 });
    expect(extractor.calls).toHaveLength(1);
    const succeeded = calls.find((c) => c.name === "mark_extraction_succeeded");
    expect(succeeded).toBeDefined();
    expect(succeeded?.args.p_org).toBe(ORG);
    expect(succeeded?.args.p_conversation_id).toBe(CONV);
    expect(succeeded?.args.p_input_message_ids).toEqual([MSG]);
    expect(succeeded?.args.p_confidence).toBeGreaterThan(0);
    expect(succeeded?.args.p_fields).toMatchObject({ subject: { source: "ai" } });
    // The failed path is never taken on success.
    expect(calls.some((c) => c.name === "mark_extraction_failed")).toBe(false);
  });

  it("DEGRADATION: an extractor that throws still writes a manual draft (never throws past the boundary)", async () => {
    const { supabase, calls } = makeRpc([claim()]);
    const extractor = new FakeAiExtractor({ mode: "unavailable" });

    const summary = await runClaimedExtractions({ supabase, extractor, workerId: "w" });

    expect(summary).toEqual({ claimed: 1, succeeded: 0, degraded: 1 });
    const failed = calls.find((c) => c.name === "mark_extraction_failed");
    expect(failed).toBeDefined();
    expect(failed?.args.p_org).toBe(ORG);
    expect(failed?.args.p_conversation_id).toBe(CONV);
    expect(failed?.args.p_error_code).toBeTypeOf("string");
    expect(calls.some((c) => c.name === "mark_extraction_succeeded")).toBe(false);
  });

  it("DEGRADATION: a malformed extractor result degrades to a manual draft", async () => {
    const { supabase, calls } = makeRpc([claim()]);
    // An extractor whose output violates the seam schema must degrade, not persist.
    const extractor = {
      calls: [] as unknown[],
      async extractIntake() {
        return { not: "a valid result" } as never;
      },
    };

    const summary = await runClaimedExtractions({ supabase, extractor, workerId: "w" });

    expect(summary.degraded).toBe(1);
    expect(calls.some((c) => c.name === "mark_extraction_failed")).toBe(true);
    expect(calls.some((c) => c.name === "mark_extraction_succeeded")).toBe(false);
  });

  it("processes a batch: one success + one degradation are both terminal", async () => {
    const other = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const { supabase, calls } = makeRpc([claim(), claim({ conversationId: other })]);
    // First conversation succeeds, second throws.
    let n = 0;
    const extractor = {
      calls: [] as unknown[],
      async extractIntake(inp: { messageIds: string[] }) {
        this.calls.push(inp);
        n += 1;
        if (n === 2) throw new Error("boom");
        return {
          summary: "s",
          title: "t",
          fields: {},
          missingFields: [],
          usedMessageIds: inp.messageIds,
          overallConfidence: 0.5,
        };
      },
    };

    const summary = await runClaimedExtractions({ supabase, extractor, workerId: "w" });
    expect(summary).toEqual({ claimed: 2, succeeded: 1, degraded: 1 });
    expect(calls.filter((c) => c.name === "mark_extraction_succeeded")).toHaveLength(1);
    expect(calls.filter((c) => c.name === "mark_extraction_failed")).toHaveLength(1);
  });

  it("returns an empty summary when nothing is claimed", async () => {
    const { supabase } = makeRpc([]);
    const extractor = new FakeAiExtractor();
    const summary = await runClaimedExtractions({ supabase, extractor, workerId: "w" });
    expect(summary).toEqual({ claimed: 0, succeeded: 0, degraded: 0 });
    expect(extractor.calls).toHaveLength(0);
  });
});
