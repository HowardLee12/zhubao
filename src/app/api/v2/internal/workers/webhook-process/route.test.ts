import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAdminSupabaseClient: vi.fn(),
  processClaimedWebhookEvents: vi.fn(),
}));

vi.mock("@/server/supabase/admin", () => ({
  createAdminSupabaseClient: mocks.createAdminSupabaseClient,
}));
vi.mock("@/server/integrations/line/webhook-gateway", () => ({
  processClaimedWebhookEvents: mocks.processClaimedWebhookEvents,
}));

import { POST } from "./route";

const WORKER_SECRET = "worker-secret-value-abcdefghijklmnop";

function request(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/v2/internal/workers/webhook-process", {
    method: "POST",
    headers,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.WORKER_SECRET = WORKER_SECRET;
  mocks.createAdminSupabaseClient.mockReturnValue({ rpc: vi.fn(), schema: vi.fn() });
  mocks.processClaimedWebhookEvents.mockResolvedValue({
    claimed: 1,
    processed: 1,
    ignored: 0,
    failed: 0,
  });
});

describe("POST /api/v2/internal/workers/webhook-process", () => {
  it("rejects without the worker secret (401) and never processes", async () => {
    const response = await POST(request());
    expect(response.status).toBe(401);
    expect(mocks.processClaimedWebhookEvents).not.toHaveBeenCalled();
  });

  it("processes claimed webhook events with the worker secret", async () => {
    const response = await POST(request({ authorization: `Bearer ${WORKER_SECRET}` }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.processed).toBe(1);
    expect(mocks.processClaimedWebhookEvents).toHaveBeenCalledTimes(1);
  });

  it("wires resolveFacts + applyFollowChange against the customer identity table", async () => {
    // resolveFacts reads the identity row (watermark now comes from last_event_at);
    // applyFollowChange/advanceWatermark go through the apply_line_identity_event RPC
    // so friend_status + apply columns + watermark move atomically.
    const identityBuilder = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          id: "identity-1",
          friend_status: "unfollowed",
          followed_at: null,
          unfollowed_at: "2026-07-19T00:00:00+00:00",
          last_event_at: "2026-07-19T00:00:00+00:00",
        },
        error: null,
      }),
    };
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    const admin = {
      schema: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue(identityBuilder) }),
      rpc,
    };
    mocks.createAdminSupabaseClient.mockReturnValue(admin);

    await POST(request({ authorization: `Bearer ${WORKER_SECRET}` }));
    const input = mocks.processClaimedWebhookEvents.mock.calls[0][0];

    const event = {
      id: "e1",
      organizationId: "o",
      lineChannelId: "c",
      webhookEventId: "w1",
      eventType: "follow",
      eventTimestamp: "2026-07-20T00:00:00+00:00",
      payload: { source: { userId: "Uxyz" } },
      attemptCount: 0,
    };

    const facts = await input.resolveFacts(event);
    expect(facts.currentFriendStatus).toBe("unfollowed");
    expect(facts.lastAppliedTimestamp).toBe("2026-07-19T00:00:00+00:00");

    // Applying a follow calls the apply RPC with the next friend status.
    await input.applyFollowChange(event, "friend");
    expect(rpc).toHaveBeenCalledWith(
      "apply_line_identity_event",
      expect.objectContaining({
        p_identity_id: "identity-1",
        p_event_timestamp: event.eventTimestamp,
        p_next_friend_status: "friend",
      }),
    );

    // A no_state_change ignore advances the watermark only (null next status).
    await input.advanceWatermark(event);
    expect(rpc).toHaveBeenLastCalledWith(
      "apply_line_identity_event",
      expect.objectContaining({
        p_identity_id: "identity-1",
        p_event_timestamp: event.eventTimestamp,
        p_next_friend_status: null,
      }),
    );

    // An event with no LINE user id resolves to unknown/null (durable but inert).
    const facts2 = await input.resolveFacts({ ...event, payload: {} });
    expect(facts2).toEqual({ currentFriendStatus: "unknown", lastAppliedTimestamp: null });
  });
});
