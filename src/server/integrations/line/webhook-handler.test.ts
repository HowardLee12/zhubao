import { describe, expect, it } from "vitest";

import {
  decideMessageIngest,
  decideWebhookApply,
  type FriendStatus,
  type WebhookApplyFacts,
} from "./webhook-handler";
import {
  processClaimedWebhookEvents,
  type ClaimedWebhookEvent,
} from "./webhook-gateway";

describe("decideMessageIngest (M7 message branch)", () => {
  const payload = (over: Record<string, unknown> = {}) => ({
    type: "message",
    timestamp: 1_700_000_000_000,
    source: { type: "user", userId: "Uabc123" },
    message: { id: "line-msg-1", type: "text", text: "冷氣不冷" },
    ...over,
  });

  it("ingests a text message with the sender line_user_id and text content", () => {
    const decision = decideMessageIngest(payload());
    expect(decision.action).toBe("ingest");
    if (decision.action === "ingest") {
      expect(decision.lineUserId).toBe("Uabc123");
      expect(decision.lineMessageId).toBe("line-msg-1");
      expect(decision.messageType).toBe("text");
      expect(decision.textContent).toBe("冷氣不冷");
      expect(decision.isImage).toBe(false);
    }
  });

  it("marks an image message for media download (isImage, no text)", () => {
    const decision = decideMessageIngest(
      payload({ message: { id: "line-msg-2", type: "image" } }),
    );
    expect(decision.action).toBe("ingest");
    if (decision.action === "ingest") {
      expect(decision.messageType).toBe("image");
      expect(decision.isImage).toBe(true);
      expect(decision.textContent).toBeNull();
    }
  });

  it("maps a sticker to the sticker type with no text", () => {
    const decision = decideMessageIngest(
      payload({ message: { id: "line-msg-3", type: "sticker", packageId: "1" } }),
    );
    expect(decision.action).toBe("ingest");
    if (decision.action === "ingest") expect(decision.messageType).toBe("sticker");
  });

  it("maps an unknown message subtype to 'other'", () => {
    const decision = decideMessageIngest(
      payload({ message: { id: "line-msg-4", type: "location" } }),
    );
    expect(decision.action).toBe("ingest");
    if (decision.action === "ingest") expect(decision.messageType).toBe("other");
  });

  it("ignores a non-message event type", () => {
    const decision = decideMessageIngest(payload({ type: "follow", message: undefined }));
    expect(decision.action).toBe("ignore");
    if (decision.action === "ignore") expect(decision.reason).toBe("not_a_message");
  });

  it("ignores a message from a non-user source (group/room) — no sender identity to aggregate", () => {
    const decision = decideMessageIngest(payload({ source: { type: "group", groupId: "G1" } }));
    expect(decision.action).toBe("ignore");
    if (decision.action === "ignore") expect(decision.reason).toBe("missing_sender");
  });

  it("ignores a malformed message with no id", () => {
    const decision = decideMessageIngest(payload({ message: { type: "text", text: "hi" } }));
    expect(decision.action).toBe("ignore");
    if (decision.action === "ignore") expect(decision.reason).toBe("missing_message_id");
  });
});

const base: WebhookApplyFacts = {
  eventType: "follow",
  eventTimestamp: "2026-07-20T10:00:00.000Z",
  currentFriendStatus: "unknown",
  lastAppliedTimestamp: null,
};

describe("decideWebhookApply", () => {
  it("applies a follow when there is no prior applied event", () => {
    const decision = decideWebhookApply(base);
    expect(decision.action).toBe("apply");
    if (decision.action === "apply") expect(decision.nextFriendStatus).toBe("friend");
  });

  it("applies an unfollow that is newer than the last applied event", () => {
    const decision = decideWebhookApply({
      ...base,
      eventType: "unfollow",
      currentFriendStatus: "friend",
      lastAppliedTimestamp: "2026-07-20T09:00:00.000Z",
    });
    expect(decision.action).toBe("apply");
    if (decision.action === "apply") expect(decision.nextFriendStatus).toBe("unfollowed");
  });

  it("ignores an event whose timestamp is older than the last applied (out of order)", () => {
    const decision = decideWebhookApply({
      ...base,
      eventType: "unfollow",
      eventTimestamp: "2026-07-20T08:00:00.000Z",
      lastAppliedTimestamp: "2026-07-20T09:00:00.000Z",
    });
    expect(decision.action).toBe("ignore");
    if (decision.action === "ignore") expect(decision.reason).toBe("stale_out_of_order");
  });

  it("ignores an event whose timestamp equals the last applied (already applied)", () => {
    const decision = decideWebhookApply({
      ...base,
      eventTimestamp: "2026-07-20T09:00:00.000Z",
      lastAppliedTimestamp: "2026-07-20T09:00:00.000Z",
    });
    expect(decision.action).toBe("ignore");
    if (decision.action === "ignore") expect(decision.reason).toBe("stale_out_of_order");
  });

  it("ignores a no-op follow when already a friend (idempotent redelivery)", () => {
    const decision = decideWebhookApply({
      ...base,
      currentFriendStatus: "friend",
      lastAppliedTimestamp: "2026-07-20T09:00:00.000Z",
    });
    expect(decision.action).toBe("ignore");
    if (decision.action === "ignore") expect(decision.reason).toBe("no_state_change");
  });

  it("ignores an unfollow when already unfollowed (no-op)", () => {
    const decision = decideWebhookApply({
      ...base,
      eventType: "unfollow",
      currentFriendStatus: "unfollowed",
      lastAppliedTimestamp: "2026-07-20T09:00:00.000Z",
    });
    expect(decision.action).toBe("ignore");
    if (decision.action === "ignore") expect(decision.reason).toBe("no_state_change");
  });

  it("ignores a message event (durably stored, no domain state change in M6)", () => {
    const decision = decideWebhookApply({ ...base, eventType: "message" });
    expect(decision.action).toBe("ignore");
    if (decision.action === "ignore") expect(decision.reason).toBe("unhandled_event_type");
  });

  it("ignores an unhandled event type (e.g. postback)", () => {
    const decision = decideWebhookApply({ ...base, eventType: "postback" });
    expect(decision.action).toBe("ignore");
    if (decision.action === "ignore") expect(decision.reason).toBe("unhandled_event_type");
  });

  it("ignores an event with an unparseable timestamp (fail safe)", () => {
    const decision = decideWebhookApply({ ...base, eventTimestamp: "not-a-timestamp" });
    expect(decision.action).toBe("ignore");
    if (decision.action === "ignore") expect(decision.reason).toBe("invalid_timestamp");
  });
});

// The out-of-order watermark must advance on EVERY terminally-processed follow /
// unfollow — applied OR ignored-as-no_state_change — not just on an apply. This
// exercises the exact review sequence through the real process loop against an
// in-memory identity whose lastAppliedTimestamp is derived from last_event_at.
describe("processClaimedWebhookEvents — no_state_change advances the ordering watermark", () => {
  interface Identity {
    friendStatus: FriendStatus;
    // The single ordering point: the timestamp of the last SEEN follow/unfollow,
    // moved forward on both apply and no_state_change (never on other ignores).
    lastEventAt: string | null;
  }

  const claimedEvent = (
    id: string,
    eventType: string,
    eventTimestamp: string,
  ): ClaimedWebhookEvent => ({
    id,
    organizationId: "a1000000-0000-4000-8000-000000000001",
    lineChannelId: "a1c00000-0000-4000-8000-000000000001",
    webhookEventId: id,
    eventType,
    eventTimestamp,
    payload: { type: eventType, source: { userId: "Uabc" } },
    attemptCount: 0,
  });

  // Drive one claimed event through the process loop against a mutable-by-replacement
  // identity ref. resolveFacts reads the watermark; applyFollowChange advances status
  // AND watermark; advanceWatermark advances ONLY the watermark (never backward).
  async function runOne(
    identityRef: { current: Identity },
    event: ClaimedWebhookEvent,
  ): Promise<{ processed: number; ignored: number; failed: number }> {
    const marks: string[] = [];
    const client = {
      rpc: async (name: string, args: { p_event_id?: string; p_note?: string }) => {
        if (name === "claim_line_webhook_events") return { data: [event], error: null };
        if (
          name === "mark_webhook_processed" ||
          name === "mark_webhook_ignored" ||
          name === "mark_webhook_failed"
        ) {
          marks.push(`${name}:${args.p_note ?? ""}`);
          return { data: { id: args.p_event_id, status: name }, error: null };
        }
        return { data: null, error: { message: `no handler for ${name}` } };
      },
    } as unknown as Parameters<typeof processClaimedWebhookEvents>[0]["supabase"];

    const advanceTo = (eventTimestamp: string): string => {
      const current = identityRef.current.lastEventAt;
      return current !== null && Date.parse(current) >= Date.parse(eventTimestamp)
        ? current
        : eventTimestamp;
    };

    const summary = await processClaimedWebhookEvents({
      supabase: client,
      workerId: "w",
      resolveFacts: async () => ({
        currentFriendStatus: identityRef.current.friendStatus,
        lastAppliedTimestamp: identityRef.current.lastEventAt,
      }),
      applyFollowChange: async (evt, nextFriendStatus) => {
        identityRef.current = {
          friendStatus: nextFriendStatus,
          lastEventAt: advanceTo(evt.eventTimestamp),
        };
      },
      advanceWatermark: async (evt) => {
        identityRef.current = {
          ...identityRef.current,
          lastEventAt: advanceTo(evt.eventTimestamp),
        };
      },
    });
    void marks;
    return { processed: summary.processed, ignored: summary.ignored, failed: summary.failed };
  }

  const T100 = "2026-07-20T10:00:00.000Z";
  const T120 = "2026-07-20T10:20:00.000Z";
  const T150 = "2026-07-20T10:50:00.000Z";

  it("follow@100 apply -> follow@150 no_state_change -> unfollow@120 is REJECTED as stale", async () => {
    const identityRef = { current: { friendStatus: "unknown", lastEventAt: null } as Identity };

    // 1. follow@100 — first real signal, applied. Watermark moves to 100.
    const first = await runOne(identityRef, claimedEvent("evt-follow-100", "follow", T100));
    expect(first).toEqual({ processed: 1, ignored: 0, failed: 0 });
    expect(identityRef.current.friendStatus).toBe("friend");
    expect(identityRef.current.lastEventAt).toBe(T100);

    // 2. follow@150 — newer but no state change (already friend). The FIX: the
    //    watermark must still advance to 150 even though nothing was applied.
    const second = await runOne(identityRef, claimedEvent("evt-follow-150", "follow", T150));
    expect(second).toEqual({ processed: 0, ignored: 1, failed: 0 });
    expect(identityRef.current.friendStatus).toBe("friend");
    expect(identityRef.current.lastEventAt).toBe(T150);

    // 3. unfollow@120 — arrives out of order. Because the watermark is now 150
    //    (the true last-SEEN signal), 120 < 150 -> rejected as stale. Identity
    //    stays friend. (Pre-fix, the watermark was stuck at 100 and this wrongly
    //    flipped friend -> unfollowed.)
    const third = await runOne(identityRef, claimedEvent("evt-unfollow-120", "unfollow", T120));
    expect(third).toEqual({ processed: 0, ignored: 1, failed: 0 });
    expect(identityRef.current.friendStatus).toBe("friend");
    expect(identityRef.current.lastEventAt).toBe(T150);
  });

  it("a genuinely newer unfollow (after the last seen follow) still applies", async () => {
    const identityRef = { current: { friendStatus: "unknown", lastEventAt: null } as Identity };
    await runOne(identityRef, claimedEvent("evt-follow-100", "follow", T100));
    await runOne(identityRef, claimedEvent("evt-follow-150", "follow", T150));
    // unfollow@ >150 is newer than the last seen signal -> applies.
    const T200 = "2026-07-20T11:00:00.000Z";
    const result = await runOne(identityRef, claimedEvent("evt-unfollow-200", "unfollow", T200));
    expect(result).toEqual({ processed: 1, ignored: 0, failed: 0 });
    expect(identityRef.current.friendStatus).toBe("unfollowed");
    expect(identityRef.current.lastEventAt).toBe(T200);
  });
});
