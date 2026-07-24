import { z } from "zod";

// LINE Messaging API webhook envelope. We validate only the structural shape we
// depend on for ingestion + ordering: the `destination` (bot user id, checked
// against the channel), and each event's `webhookEventId`, `type` and `timestamp`
// (epoch millis). The full raw event is persisted verbatim; these schemas gate
// which fields we read, never mutate the payload. Unknown event fields are allowed
// (LINE evolves the schema) but the ENVELOPE is strict about the keys we require.

// A single delivery event. LINE guarantees `type` and `timestamp`; `webhookEventId`
// is present on modern deliveries and drives the primary dedupe. Redelivery events
// omit some fields, so only the ordering/identity fields are required.
export const lineWebhookEventSchema = z
  .looseObject({
    type: z.string().min(1).max(120),
    timestamp: z.number().int().nonnegative(),
    webhookEventId: z.string().min(1).max(200).optional(),
    mode: z.string().optional(),
  });

export type LineWebhookEvent = z.infer<typeof lineWebhookEventSchema>;

// The webhook request body. `events` may be empty (LINE sends a verify ping with an
// empty array). Capped at 100 events per delivery (LINE's documented batch ceiling).
export const lineWebhookBodySchema = z
  .looseObject({
    destination: z.string().min(1).max(200),
    events: z.array(lineWebhookEventSchema).max(100),
  });

export type LineWebhookBody = z.infer<typeof lineWebhookBodySchema>;

// The subset of event kinds the M6 handler can act on. Anything outside this set is
// durably stored but ignored by the processor (no domain write). Kept explicit so a
// new event type is a conscious addition, not a silent apply.
export const HANDLED_LINE_EVENT_TYPES = ["follow", "unfollow", "message"] as const;
export type HandledLineEventType = (typeof HANDLED_LINE_EVENT_TYPES)[number];
