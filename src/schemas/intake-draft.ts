import { z } from "zod";

import { extractionFieldsSchema } from "./ai-extraction";

// Staff-facing DTOs for the "待確認進件草稿" inbox and detail view, plus the
// confirm/dismiss request bodies. A draft is never an action: confirm turns it into
// a service_request that a human then triages (M3); dismiss drops it. origin='ai'
// vs 'manual' tells the reviewer whether the AI produced the summary or the run
// degraded (AI unavailable) into a manual draft — the message is never lost either
// way.

export const intakeDraftStatusSchema = z.enum([
  "pending_review",
  "confirmed",
  "dismissed",
  "superseded",
]);
export type IntakeDraftStatus = z.infer<typeof intakeDraftStatusSchema>;

export const intakeDraftOriginSchema = z.enum(["ai", "manual"]);
export type IntakeDraftOrigin = z.infer<typeof intakeDraftOriginSchema>;

// A list-view card. source is always 'line' for M7 (the only intake channel that
// produces drafts); confidence/origin drive the "待確認 · LINE" badge.
export const intakeDraftListItemSchema = z
  .object({
    id: z.uuid(),
    conversationId: z.uuid(),
    status: intakeDraftStatusSchema,
    origin: intakeDraftOriginSchema,
    source: z.literal("line"),
    title: z.string().nullable(),
    summary: z.string().nullable(),
    confidence: z.number().min(0).max(1).nullable(),
    missingFields: z.array(z.string()),
    lineUserId: z.string(),
    messageCount: z.number().int().min(0),
    lastMessageAt: z.iso.datetime({ offset: true }).nullable(),
    lockVersion: z.number().int().min(1),
    createdAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .strict();
export type IntakeDraftListItem = z.infer<typeof intakeDraftListItemSchema>;

// One immutable original message shown in the detail timeline. text is the verbatim
// customer content (null for image/sticker); attachments carry the private-bucket
// storage path (the route resolves a short-lived signed URL, never a public URL).
export const intakeDraftMessageSchema = z
  .object({
    id: z.uuid(),
    messageType: z.enum(["text", "image", "sticker", "other"]),
    text: z.string().nullable(),
    sentAt: z.iso.datetime({ offset: true }).nullable(),
    receivedAt: z.iso.datetime({ offset: true }),
    attachments: z.array(
      z
        .object({
          id: z.uuid(),
          kind: z.literal("image"),
          status: z.string(),
          storagePath: z.string().nullable(),
        })
        .strict(),
    ),
  })
  .strict();
export type IntakeDraftMessage = z.infer<typeof intakeDraftMessageSchema>;

// The detail DTO: the draft card fields + the AI per-field map (with provenance +
// confidence) + the immutable original-message timeline. This is what the review
// screen renders read-only-left / editable-right.
export const intakeDraftDetailSchema = z
  .object({
    id: z.uuid(),
    conversationId: z.uuid(),
    status: intakeDraftStatusSchema,
    origin: intakeDraftOriginSchema,
    source: z.literal("line"),
    title: z.string().nullable(),
    summary: z.string().nullable(),
    confidence: z.number().min(0).max(1).nullable(),
    fields: extractionFieldsSchema,
    missingFields: z.array(z.string()),
    lineUserId: z.string(),
    customerLineIdentityId: z.uuid().nullable(),
    convertedServiceRequestId: z.uuid().nullable(),
    lockVersion: z.number().int().min(1),
    createdAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true }),
    messages: z.array(intakeDraftMessageSchema),
  })
  .strict();
export type IntakeDraftDetail = z.infer<typeof intakeDraftDetailSchema>;

// POST confirm body. The optimistic lock arrives in If-Match and the idempotency
// key in the Idempotency-Key header; the body only carries optional field overrides
// the reviewer edited before confirming (per-field { value, source, confidence }).
export const confirmIntakeDraftRequestSchema = z
  .object({
    fieldOverrides: extractionFieldsSchema.optional(),
  })
  .strict();
export type ConfirmIntakeDraftRequest = z.infer<typeof confirmIntakeDraftRequestSchema>;

// confirm_intake_draft returns this jsonb envelope (camelCase already).
export const confirmIntakeDraftEnvelopeSchema = z
  .object({
    serviceRequestId: z.uuid(),
    requestNo: z.string().min(1).max(40),
    draftId: z.uuid(),
    draftStatus: intakeDraftStatusSchema,
    status: z.string().min(1).max(40),
    replayed: z.boolean(),
  })
  .strict();
export type ConfirmIntakeDraftEnvelope = z.infer<typeof confirmIntakeDraftEnvelopeSchema>;

// POST dismiss body. Optional reason (spam / unparseable). If-Match carries the lock.
export const dismissIntakeDraftRequestSchema = z
  .object({
    reason: z.string().min(1).max(500).optional(),
  })
  .strict();
export type DismissIntakeDraftRequest = z.infer<typeof dismissIntakeDraftRequestSchema>;

export const dismissIntakeDraftEnvelopeSchema = z
  .object({
    draftId: z.uuid(),
    draftStatus: z.literal("dismissed"),
    replayed: z.boolean(),
  })
  .strict();
export type DismissIntakeDraftEnvelope = z.infer<typeof dismissIntakeDraftEnvelopeSchema>;
