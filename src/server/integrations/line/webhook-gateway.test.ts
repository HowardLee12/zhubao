import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import {
  computePayloadSha256,
  ingestWebhookEvents,
  processClaimedWebhookEvents,
  type ClaimedWebhookEvent,
} from "./webhook-gateway";

type Rpc = Pick<SupabaseClient, "rpc"> & { rpc: ReturnType<typeof vi.fn> };

function rpcClient(
  handlers: Record<string, (args: unknown) => { data: unknown; error: unknown }>,
): Rpc {
  return {
    rpc: vi.fn(async (name: string, args: unknown) =>
      handlers[name]?.(args) ?? { data: null, error: { message: `no handler for ${name}` } },
    ),
  } as unknown as Rpc;
}

describe("computePayloadSha256", () => {
  it("produces a 64-char lowercase hex digest", () => {
    const hash = computePayloadSha256(new TextEncoder().encode("{}"));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is stable for identical bytes", () => {
    const bytes = new TextEncoder().encode('{"a":1}');
    expect(computePayloadSha256(bytes)).toBe(computePayloadSha256(bytes));
  });
});

describe("ingestWebhookEvents", () => {
  const channelId = "a1c00000-0000-4000-8000-000000000001";
  const rawBody = new TextEncoder().encode(
    JSON.stringify({
      destination: "Ubot",
      events: [
        { type: "follow", timestamp: 1_700_000_000_000, webhookEventId: "evt-1" },
        { type: "message", timestamp: 1_700_000_001_000, webhookEventId: "evt-2" },
      ],
    }),
  );

  it("ingests each event and counts new vs duplicate", async () => {
    const calls: unknown[] = [];
    const client = rpcClient({
      ingest_line_webhook_event: (args) => {
        calls.push(args);
        const isFirst = (args as { p_webhook_event_id: string }).p_webhook_event_id === "evt-1";
        return { data: { duplicate: !isFirst, id: isFirst ? "row-1" : null }, error: null };
      },
    });
    const summary = await ingestWebhookEvents({
      supabase: client,
      channelId,
      rawBody,
    });
    expect(summary.ingested).toBe(1);
    expect(summary.duplicate).toBe(1);
    expect(calls).toHaveLength(2);
    // The sha256 passed for each event is the digest of the WHOLE raw body (LINE
    // signs the batch; per-event dedupe uses webhookEventId primarily).
    expect((calls[0] as { p_payload_sha256: string }).p_payload_sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("throws when an ingest RPC errors", async () => {
    const client = rpcClient({
      ingest_line_webhook_event: () => ({ data: null, error: { message: "channel gone" } }),
    });
    await expect(
      ingestWebhookEvents({ supabase: client, channelId, rawBody }),
    ).rejects.toThrow();
  });

  it("ingests zero events for a verify ping (empty events array)", async () => {
    const client = rpcClient({ ingest_line_webhook_event: () => ({ data: {}, error: null }) });
    const summary = await ingestWebhookEvents({
      supabase: client,
      channelId,
      rawBody: new TextEncoder().encode(JSON.stringify({ destination: "Ubot", events: [] })),
    });
    expect(summary.ingested).toBe(0);
    expect(summary.duplicate).toBe(0);
    expect(client.rpc).not.toHaveBeenCalled();
  });
});

describe("processClaimedWebhookEvents", () => {
  const followEvent: ClaimedWebhookEvent = {
    id: "row-1",
    organizationId: "a1000000-0000-4000-8000-000000000001",
    lineChannelId: "a1c00000-0000-4000-8000-000000000001",
    webhookEventId: "evt-1",
    eventType: "follow",
    eventTimestamp: "2026-07-20T10:00:00.000Z",
    payload: { type: "follow", timestamp: 1_700_000_000_000, source: { userId: "Uabc" } },
    attemptCount: 0,
  };

  it("claims and marks an applicable follow as processed", async () => {
    let marked = "";
    const client = rpcClient({
      claim_line_webhook_events: () => ({ data: [followEvent], error: null }),
      mark_webhook_processed: () => {
        marked = "processed";
        return { data: { id: "row-1", status: "processed" }, error: null };
      },
    });
    const summary = await processClaimedWebhookEvents({
      supabase: client,
      workerId: "w",
      resolveFacts: async () => ({ currentFriendStatus: "unknown", lastAppliedTimestamp: null }),
      applyFollowChange: async () => {},
      advanceWatermark: async () => {},
    });
    expect(summary.processed).toBe(1);
    expect(summary.ignored).toBe(0);
    expect(marked).toBe("processed");
  });

  it("marks an unhandled event type as ignored (no apply)", async () => {
    let marked = "";
    const applyFollowChange = vi.fn(async () => {});
    const client = rpcClient({
      claim_line_webhook_events: () => ({
        data: [{ ...followEvent, eventType: "message" }],
        error: null,
      }),
      mark_webhook_ignored: () => {
        marked = "ignored";
        return { data: { id: "row-1", status: "ignored" }, error: null };
      },
    });
    const summary = await processClaimedWebhookEvents({
      supabase: client,
      workerId: "w",
      resolveFacts: async () => ({ currentFriendStatus: "unknown", lastAppliedTimestamp: null }),
      applyFollowChange,
      advanceWatermark: async () => {},
    });
    expect(summary.ignored).toBe(1);
    expect(marked).toBe("ignored");
    expect(applyFollowChange).not.toHaveBeenCalled();
  });

  it("marks a row failed when apply throws", async () => {
    let marked = "";
    const client = rpcClient({
      claim_line_webhook_events: () => ({ data: [followEvent], error: null }),
      mark_webhook_failed: () => {
        marked = "failed";
        return { data: { id: "row-1", status: "failed" }, error: null };
      },
    });
    const summary = await processClaimedWebhookEvents({
      supabase: client,
      workerId: "w",
      resolveFacts: async () => ({ currentFriendStatus: "unknown", lastAppliedTimestamp: null }),
      applyFollowChange: async () => {
        throw new Error("apply blew up");
      },
      advanceWatermark: async () => {},
    });
    expect(summary.failed).toBe(1);
    expect(marked).toBe("failed");
  });

  it("returns an empty summary when nothing is claimed", async () => {
    const client = rpcClient({ claim_line_webhook_events: () => ({ data: [], error: null }) });
    const summary = await processClaimedWebhookEvents({
      supabase: client,
      workerId: "w",
      resolveFacts: async () => ({ currentFriendStatus: "unknown", lastAppliedTimestamp: null }),
      applyFollowChange: async () => {},
      advanceWatermark: async () => {},
    });
    expect(summary).toEqual({ claimed: 0, processed: 0, ignored: 0, failed: 0 });
  });
});

describe("processClaimedWebhookEvents — M7 message branch", () => {
  const messageEvent = (over: Record<string, unknown> = {}): ClaimedWebhookEvent => ({
    id: "evt-msg-1",
    organizationId: "20000000-0000-4000-8000-000000000001",
    lineChannelId: "a1c00000-0000-4000-8000-000000000001",
    webhookEventId: "evt-msg-1",
    eventType: "message",
    eventTimestamp: "2026-07-20T10:00:00.000Z",
    payload: {
      type: "message",
      source: { type: "user", userId: "Uabc" },
      message: { id: "line-msg-1", type: "text", text: "冷氣不冷" },
    },
    attemptCount: 0,
    ...over,
  });

  function noopFacts() {
    return {
      resolveFacts: async () => ({ currentFriendStatus: "unknown" as const, lastAppliedTimestamp: null }),
      applyFollowChange: async () => {},
      advanceWatermark: async () => {},
    };
  }

  it("routes a text message to the ingestMessage seam and marks it processed", async () => {
    let marked: string | null = null;
    const client = rpcClient({
      claim_line_webhook_events: () => ({ data: [messageEvent()], error: null }),
      mark_webhook_processed: () => {
        marked = "processed";
        return { data: { id: "evt-msg-1", status: "processed" }, error: null };
      },
    });
    const ingested: Array<{ lineMessageId: string; isImage: boolean }> = [];

    const summary = await processClaimedWebhookEvents({
      supabase: client,
      workerId: "w",
      ...noopFacts(),
      ingestMessage: async (_event, command) => {
        ingested.push({ lineMessageId: command.lineMessageId, isImage: command.isImage });
      },
    });

    expect(summary).toMatchObject({ processed: 1, ignored: 0, failed: 0 });
    expect(marked).toBe("processed");
    expect(ingested).toEqual([{ lineMessageId: "line-msg-1", isImage: false }]);
  });

  it("flags an image message for media download", async () => {
    const client = rpcClient({
      claim_line_webhook_events: () => ({
        data: [messageEvent({ payload: { type: "message", source: { type: "user", userId: "Uabc" }, message: { id: "img-1", type: "image" } } })],
        error: null,
      }),
      mark_webhook_processed: () => ({ data: { id: "evt-msg-1", status: "processed" }, error: null }),
    });
    let sawImage = false;
    await processClaimedWebhookEvents({
      supabase: client,
      workerId: "w",
      ...noopFacts(),
      ingestMessage: async (_event, command) => {
        sawImage = command.isImage;
      },
    });
    expect(sawImage).toBe(true);
  });

  it("marks a group message ignored (missing sender) without calling the seam", async () => {
    let ingestCalls = 0;
    const client = rpcClient({
      claim_line_webhook_events: () => ({
        data: [messageEvent({ payload: { type: "message", source: { type: "group", groupId: "G1" }, message: { id: "m", type: "text", text: "hi" } } })],
        error: null,
      }),
      mark_webhook_ignored: () => ({ data: { id: "evt-msg-1", status: "ignored" }, error: null }),
    });
    const summary = await processClaimedWebhookEvents({
      supabase: client,
      workerId: "w",
      ...noopFacts(),
      ingestMessage: async () => {
        ingestCalls += 1;
      },
    });
    expect(summary.ignored).toBe(1);
    expect(ingestCalls).toBe(0);
  });

  it("a message event with no ingestMessage seam falls through to the M6 ignore path", async () => {
    const client = rpcClient({
      claim_line_webhook_events: () => ({ data: [messageEvent()], error: null }),
      mark_webhook_ignored: () => ({ data: { id: "evt-msg-1", status: "ignored" }, error: null }),
    });
    const summary = await processClaimedWebhookEvents({
      supabase: client,
      workerId: "w",
      ...noopFacts(),
    });
    expect(summary.ignored).toBe(1);
  });

  it("an ingestMessage that throws marks the event failed (re-claimable)", async () => {
    let marked: string | null = null;
    const client = rpcClient({
      claim_line_webhook_events: () => ({ data: [messageEvent()], error: null }),
      mark_webhook_failed: () => {
        marked = "failed";
        return { data: { id: "evt-msg-1", status: "failed" }, error: null };
      },
    });
    const summary = await processClaimedWebhookEvents({
      supabase: client,
      workerId: "w",
      ...noopFacts(),
      ingestMessage: async () => {
        throw new Error("ingest blew up");
      },
    });
    expect(summary.failed).toBe(1);
    expect(marked).toBe("failed");
  });
});
