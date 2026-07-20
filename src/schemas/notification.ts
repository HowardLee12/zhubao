import { z } from "zod";

// Notification (outbox) schemas: the staff-facing list query + the redacted view
// DTO, plus the worker dispatch request body. Per security.md the client view NEVER
// exposes cost/secret material — only operational status, attempt counters and a
// coarse provider signal (whether a provider message id exists, not its value).

export const NOTIFICATION_CHANNELS = ["line", "in_app", "email", "sms"] as const;
export const NOTIFICATION_STATUSES = [
  "pending",
  "processing",
  "sent",
  "delivered",
  "failed",
  "cancelled",
] as const;
export const NOTIFICATION_RELATED_TYPES = [
  "service_request",
  "quote",
  "work_order",
  "change_order",
  "payment_milestone",
  "maintenance_plan",
] as const;

// GET .../notifications query. All filters optional; cursor is an opaque keyset
// token (validated as a bounded string, decoded downstream). pageSize is clamped.
export const notificationListQuerySchema = z
  .object({
    status: z.enum(NOTIFICATION_STATUSES).optional(),
    channel: z.enum(NOTIFICATION_CHANNELS).optional(),
    relatedType: z.enum(NOTIFICATION_RELATED_TYPES).optional(),
    cursor: z.string().trim().min(1).max(500).optional(),
    pageSize: z.coerce.number().int().min(1).max(100).optional(),
  })
  .strict();

export type NotificationListQuery = z.infer<typeof notificationListQuerySchema>;

// Redacted notification view. `providerMessageId` presence is exposed as a boolean
// signal (hasProviderMessage) rather than the raw id; payload is NOT included in the
// list DTO. attemptCount / maxAttempts / lastErrorCode drive the outbox UI.
export const notificationViewSchema = z
  .object({
    id: z.uuid(),
    channel: z.enum(NOTIFICATION_CHANNELS),
    templateKey: z.string(),
    templateVersion: z.number().int().positive(),
    status: z.enum(NOTIFICATION_STATUSES),
    approvalStatus: z.enum(["not_required", "pending", "approved", "rejected"]),
    attemptCount: z.number().int().min(0),
    maxAttempts: z.number().int().positive(),
    lastErrorCode: z.string().nullable(),
    hasProviderMessage: z.boolean(),
    relatedType: z.enum(NOTIFICATION_RELATED_TYPES).nullable(),
    relatedId: z.uuid().nullable(),
    scheduledAt: z.string().nullable(),
    nextAttemptAt: z.string().nullable(),
    sentAt: z.string().nullable(),
    failedAt: z.string().nullable(),
    cancelledAt: z.string().nullable(),
    createdAt: z.string(),
  })
  .strict();

export type NotificationView = z.infer<typeof notificationViewSchema>;

// Worker dispatch request body (internal worker route, Bearer-guarded). limit is
// clamped 1..50 to match claim_notifications.
export const notificationDispatchRequestSchema = z
  .object({
    limit: z.number().int().min(1).max(50).optional(),
  })
  .strict();

export type NotificationDispatchRequest = z.infer<typeof notificationDispatchRequestSchema>;

// The classification a LineMessenger failure maps to. `retriable` covers 429/5xx
// (schedule backoff); `permanent` covers 4xx (fail immediately, no retry).
export const NOTIFICATION_FAILURE_CLASSES = ["retriable", "permanent"] as const;
export type NotificationFailureClass = (typeof NOTIFICATION_FAILURE_CLASSES)[number];
