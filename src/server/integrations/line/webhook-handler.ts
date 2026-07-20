// Pure apply/ignore decision for an inbound LINE webhook event. This is the
// out-of-order gate: LINE does NOT guarantee delivery order, so a redelivered or
// late follow/unfollow must not clobber a newer state. The decision is driven ONLY
// by event_timestamp + the current domain state, with no I/O — the webhook gateway
// loads the facts, calls this, then applies or marks-ignored accordingly.
//
// Rules (evaluated in order):
//   1. Unhandled event type (message/postback/...) -> ignore(unhandled_event_type).
//   2. Unparseable event timestamp -> ignore(invalid_timestamp) (fail safe).
//   3. Not strictly newer than the last applied event -> ignore(stale_out_of_order).
//   4. Would not change friend_status -> ignore(no_state_change) (idempotent).
//   5. Otherwise -> apply with the computed next friend_status.

export type FriendStatus = "unknown" | "friend" | "blocked" | "unfollowed";

export interface WebhookApplyFacts {
  eventType: string;
  eventTimestamp: string;
  currentFriendStatus: FriendStatus;
  lastAppliedTimestamp: string | null;
}

export type WebhookApplyDecision =
  | { action: "apply"; nextFriendStatus: FriendStatus }
  | {
      action: "ignore";
      reason:
        | "unhandled_event_type"
        | "invalid_timestamp"
        | "stale_out_of_order"
        | "no_state_change";
    };

function targetStatusFor(eventType: string): FriendStatus | null {
  if (eventType === "follow") return "friend";
  if (eventType === "unfollow") return "unfollowed";
  return null;
}

// ---------------------------------------------------------------------------
// M7 message branch: a pure decision that turns a claimed LINE 'message' webhook
// payload into an ingest command (find-or-create conversation + append message) or
// an ignore reason. No I/O — the gateway loads the claimed row, calls this, then
// invokes ingest_inbound_message (and, for images, the content fetcher). Group/room
// messages are ignored (no per-user identity to aggregate); non-message events fall
// through to the M6 follow/unfollow path.

export type InboundMessageType = "text" | "image" | "sticker" | "other";

export type MessageIngestDecision =
  | {
      action: "ingest";
      lineUserId: string;
      lineMessageId: string;
      messageType: InboundMessageType;
      textContent: string | null;
      isImage: boolean;
    }
  | {
      action: "ignore";
      reason: "not_a_message" | "missing_sender" | "missing_message_id";
    };

function mapMessageType(subtype: unknown): InboundMessageType {
  if (subtype === "text") return "text";
  if (subtype === "image") return "image";
  if (subtype === "sticker") return "sticker";
  return "other";
}

export function decideMessageIngest(payload: Record<string, unknown>): MessageIngestDecision {
  if (payload.type !== "message") {
    return { action: "ignore", reason: "not_a_message" };
  }

  // Only 1:1 user messages carry a line_user_id we can aggregate a conversation on;
  // group/room messages have no stable per-customer sender for intake.
  const source = payload.source as { type?: unknown; userId?: unknown } | undefined;
  const userId = source?.userId;
  if (source?.type !== "user" || typeof userId !== "string" || userId.length === 0) {
    return { action: "ignore", reason: "missing_sender" };
  }

  const message = payload.message as { id?: unknown; type?: unknown; text?: unknown } | undefined;
  const messageId = message?.id;
  if (typeof messageId !== "string" || messageId.length === 0) {
    return { action: "ignore", reason: "missing_message_id" };
  }

  const messageType = mapMessageType(message?.type);
  const textContent =
    messageType === "text" && typeof message?.text === "string" ? message.text : null;

  return {
    action: "ingest",
    lineUserId: userId,
    lineMessageId: messageId,
    messageType,
    textContent,
    isImage: messageType === "image",
  };
}

export function decideWebhookApply(facts: WebhookApplyFacts): WebhookApplyDecision {
  const next = targetStatusFor(facts.eventType);
  if (next === null) {
    return { action: "ignore", reason: "unhandled_event_type" };
  }

  const eventMs = Date.parse(facts.eventTimestamp);
  if (Number.isNaN(eventMs)) {
    return { action: "ignore", reason: "invalid_timestamp" };
  }

  if (facts.lastAppliedTimestamp !== null) {
    const lastMs = Date.parse(facts.lastAppliedTimestamp);
    // A non-strict comparison also rejects an exact-timestamp redelivery.
    if (!Number.isNaN(lastMs) && eventMs <= lastMs) {
      return { action: "ignore", reason: "stale_out_of_order" };
    }
  }

  if (facts.currentFriendStatus === next) {
    return { action: "ignore", reason: "no_state_change" };
  }

  return { action: "apply", nextFriendStatus: next };
}
