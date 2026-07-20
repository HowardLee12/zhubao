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
