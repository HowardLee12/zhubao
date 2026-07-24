import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { FakeLineMessenger } from "@/server/integrations/line/client";
import {
  dispatchClaimedNotifications,
  enqueueNotification,
  type ClaimedNotification,
} from "./gateway";

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

const claimed: ClaimedNotification = {
  id: "88100000-0000-4000-8000-000000000001",
  organizationId: "a1000000-0000-4000-8000-000000000001",
  channel: "line",
  lineChannelId: "a1c00000-0000-4000-8000-000000000001",
  customerLineIdentityId: "a1de0000-0000-4000-8000-000000000001",
  membershipId: null,
  templateKey: "received",
  templateVersion: 1,
  payload: { customerName: "王先生" },
  attemptCount: 0,
  maxAttempts: 5,
  dedupeKey: "sr-received-1",
  relatedType: "service_request",
  relatedId: "77700000-0000-4000-8000-000000000001",
};

const resolveTarget = async (row: ClaimedNotification) => ({
  to: `Uline-${row.customerLineIdentityId}`,
  accessToken: "channel-access-token",
});

describe("enqueueNotification", () => {
  it("forwards to the enqueue RPC and returns the parsed envelope", async () => {
    const client = rpcClient({
      enqueue_notification: () => ({
        data: { enqueued: true, notificationId: "n1", status: "pending" },
        error: null,
      }),
    });
    const result = await enqueueNotification(client, {
      organizationId: "org",
      channel: "line",
      lineChannelId: "ch",
      templateKey: "received",
      templateVersion: 1,
      payload: {},
      dedupeKey: "d1",
      relatedType: "service_request",
      relatedId: "sr1",
      customerLineIdentityId: "id1",
    });
    expect(result.enqueued).toBe(true);
    expect(result.notificationId).toBe("n1");
    expect(client.rpc).toHaveBeenCalledWith(
      "enqueue_notification",
      expect.objectContaining({ target_org: "org", p_channel: "line", p_dedupe_key: "d1" }),
    );
  });

  it("throws when the enqueue RPC returns a malformed envelope", async () => {
    const client = rpcClient({
      enqueue_notification: () => ({ data: { unexpected: true }, error: null }),
    });
    await expect(
      enqueueNotification(client, {
        organizationId: "org",
        channel: "line",
        lineChannelId: "ch",
        templateKey: "received",
        templateVersion: 1,
        payload: {},
        dedupeKey: "d1",
        relatedType: null,
        relatedId: null,
        customerLineIdentityId: "id1",
      }),
    ).rejects.toThrow();
  });

  it("throws when the enqueue RPC errors", async () => {
    const client = rpcClient({
      enqueue_notification: () => ({ data: null, error: { message: "boom" } }),
    });
    await expect(
      enqueueNotification(client, {
        organizationId: "org",
        channel: "line",
        lineChannelId: "ch",
        templateKey: "received",
        templateVersion: 1,
        payload: {},
        dedupeKey: "d1",
        relatedType: null,
        relatedId: null,
        customerLineIdentityId: "id1",
      }),
    ).rejects.toThrow();
  });
});

describe("dispatchClaimedNotifications", () => {
  it("claims, sends via the messenger, and marks each sent", async () => {
    const marks: string[] = [];
    const client = rpcClient({
      claim_notifications: () => ({ data: [claimed], error: null }),
      mark_notification_sent: () => {
        marks.push("sent");
        return { data: { id: claimed.id, status: "sent", attemptCount: 1 }, error: null };
      },
    });
    const messenger = new FakeLineMessenger();
    const summary = await dispatchClaimedNotifications({
      supabase: client,
      messenger,
      resolveTarget,
      workerId: "worker-1",
      limit: 10,
    });
    expect(summary.claimed).toBe(1);
    expect(summary.sent).toBe(1);
    expect(summary.retried).toBe(0);
    expect(summary.failed).toBe(0);
    expect(marks).toEqual(["sent"]);
    expect(messenger.sent).toHaveLength(1);
    expect(messenger.sent[0]?.to).toContain("a1de0000");
  });

  it("marks a retriable failure as retry (backoff scheduled in DB)", async () => {
    let marked = "";
    const client = rpcClient({
      claim_notifications: () => ({ data: [claimed], error: null }),
      mark_notification_retry: () => {
        marked = "retry";
        return {
          data: { id: claimed.id, status: "failed", attemptCount: 1, terminal: false },
          error: null,
        };
      },
    });
    const summary = await dispatchClaimedNotifications({
      supabase: client,
      messenger: new FakeLineMessenger({ mode: "rate_limited" }),
      resolveTarget,
      workerId: "w",
    });
    expect(marked).toBe("retry");
    expect(summary.retried).toBe(1);
    expect(summary.sent).toBe(0);
  });

  it("marks a permanent 4xx failure as failed (no retry)", async () => {
    let marked = "";
    const client = rpcClient({
      claim_notifications: () => ({ data: [claimed], error: null }),
      mark_notification_failed: () => {
        marked = "failed";
        return {
          data: { id: claimed.id, status: "failed", attemptCount: 1, terminal: true },
          error: null,
        };
      },
    });
    const summary = await dispatchClaimedNotifications({
      supabase: client,
      messenger: new FakeLineMessenger({ mode: "bad_request" }),
      resolveTarget,
      workerId: "w",
    });
    expect(marked).toBe("failed");
    expect(summary.failed).toBe(1);
  });

  it("returns an empty summary when nothing is claimed", async () => {
    const client = rpcClient({ claim_notifications: () => ({ data: [], error: null }) });
    const summary = await dispatchClaimedNotifications({
      supabase: client,
      messenger: new FakeLineMessenger(),
      resolveTarget,
      workerId: "w",
    });
    expect(summary).toEqual({ claimed: 0, sent: 0, retried: 0, failed: 0, skipped: 0 });
  });

  it("skips a row whose target cannot be resolved and marks it permanently failed", async () => {
    let marked = "";
    const client = rpcClient({
      claim_notifications: () => ({ data: [claimed], error: null }),
      mark_notification_failed: () => {
        marked = "failed";
        return { data: { id: claimed.id, status: "failed", attemptCount: 1, terminal: true }, error: null };
      },
    });
    const summary = await dispatchClaimedNotifications({
      supabase: client,
      messenger: new FakeLineMessenger(),
      resolveTarget: async () => null,
      workerId: "w",
    });
    expect(summary.skipped).toBe(1);
    expect(marked).toBe("failed");
  });

  it("throws when a mark RPC errors after a successful send", async () => {
    const client = rpcClient({
      claim_notifications: () => ({ data: [claimed], error: null }),
      mark_notification_sent: () => ({ data: null, error: { message: "mark failed" } }),
    });
    await expect(
      dispatchClaimedNotifications({
        supabase: client,
        messenger: new FakeLineMessenger(),
        resolveTarget,
        workerId: "w",
      }),
    ).rejects.toThrow();
  });

  it("throws when the retry mark RPC errors", async () => {
    const client = rpcClient({
      claim_notifications: () => ({ data: [claimed], error: null }),
      mark_notification_retry: () => ({ data: null, error: { message: "mark failed" } }),
    });
    await expect(
      dispatchClaimedNotifications({
        supabase: client,
        messenger: new FakeLineMessenger({ mode: "rate_limited" }),
        resolveTarget,
        workerId: "w",
      }),
    ).rejects.toThrow();
  });

  it("throws when the failed mark RPC errors", async () => {
    const client = rpcClient({
      claim_notifications: () => ({ data: [claimed], error: null }),
      mark_notification_failed: () => ({ data: null, error: { message: "mark failed" } }),
    });
    await expect(
      dispatchClaimedNotifications({
        supabase: client,
        messenger: new FakeLineMessenger({ mode: "bad_request" }),
        resolveTarget,
        workerId: "w",
      }),
    ).rejects.toThrow();
  });

  it("throws when the claim RPC errors", async () => {
    const client = rpcClient({
      claim_notifications: () => ({ data: null, error: { message: "db down" } }),
    });
    await expect(
      dispatchClaimedNotifications({
        supabase: client,
        messenger: new FakeLineMessenger(),
        resolveTarget,
        workerId: "w",
      }),
    ).rejects.toThrow();
  });

  it("only sends line-channel notifications through the messenger (unsupported channel skipped)", async () => {
    const inApp: ClaimedNotification = { ...claimed, channel: "in_app", lineChannelId: null };
    let marked = "";
    const client = rpcClient({
      claim_notifications: () => ({ data: [inApp], error: null }),
      mark_notification_failed: () => {
        marked = "failed";
        return { data: { id: inApp.id, status: "failed", attemptCount: 1, terminal: true }, error: null };
      },
    });
    const messenger = new FakeLineMessenger();
    const summary = await dispatchClaimedNotifications({
      supabase: client,
      messenger,
      resolveTarget,
      workerId: "w",
    });
    expect(messenger.attempts).toHaveLength(0);
    expect(summary.skipped).toBe(1);
    expect(marked).toBe("failed");
  });
});
