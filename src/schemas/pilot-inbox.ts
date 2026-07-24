import { z } from "zod";

import type { IntakeDraftListItem, IntakeDraftStatus } from "./intake-draft";

const serviceRequestStatusSchema = z.enum([
  "new",
  "triaged",
  "quoting",
  "quoted",
  "converted",
  "declined",
  "cancelled",
]);

const serviceRequestPrioritySchema = z.enum(["low", "normal", "high", "urgent"]);

const preferredWindowSchema = z
  .object({
    startsAt: z.iso.datetime({ offset: true }),
    endsAt: z.iso.datetime({ offset: true }),
    preferenceRank: z.number().int().min(1),
  })
  .strict();

// Mirrors the list_pilot_service_requests keyset RPC row shape exactly (SQL is
// the pgTAP-pinned source of truth). It is intentionally strict so any drift or
// an internal column leaking into the projection fails loudly. The keyset
// overload adds triage provenance (lockVersion/customerId/assignedMemberId/
// triagedAt/serviceCategory) on top of the legacy inbox row.
const pilotInboxRpcItemSchema = z
  .object({
    id: z.uuid(),
    requestNo: z.string().min(1).max(40),
    contactName: z.string().min(1).max(120),
    // Nullable: a LINE-sourced request (M7) is contacted via its LINE identity and
    // legitimately has no phone; a web request always carries an E.164 number. A
    // null must not blank the whole inbox, so tolerate it and validate the format
    // only when present.
    contactPhone: z
      .string()
      .regex(/^\+[1-9][0-9]{7,14}$/)
      .nullable(),
    subject: z.string().min(1).max(160),
    description: z.string().max(10_000),
    status: serviceRequestStatusSchema,
    priority: serviceRequestPrioritySchema,
    category: z.string().min(1).max(120).nullable(),
    lockVersion: z.number().int().min(1),
    customerId: z.uuid().nullable(),
    assignedMemberId: z.uuid().nullable(),
    triagedAt: z.iso.datetime({ offset: true }).nullable(),
    serviceCatalogItemId: z.uuid().nullable(),
    serviceName: z.string().min(1).max(120).nullable(),
    serviceCategory: z.string().min(1).max(120).nullable(),
    address: z.string().max(1_000).nullable(),
    photoCount: z.number().int().min(0),
    preferredWindows: z.array(preferredWindowSchema).max(20),
    createdAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export const pilotInboxRpcResultSchema = z
  .object({
    organizationId: z.uuid(),
    items: z.array(pilotInboxRpcItemSchema).max(100),
  })
  .strict();

export type PilotInboxRpcResult = z.infer<typeof pilotInboxRpcResultSchema>;
export type PilotInboxRpcItem = z.infer<typeof pilotInboxRpcItemSchema>;

// The channel a pilot inbox row came from. "web" rows are public-form service
// requests (M2/M3); "line" rows are AI/manual intake DRAFTS aggregated from LINE
// messages (M7) that a human confirms into a service request before triage.
export const pilotInboxSourceSchema = z.enum(["web", "line"]);
export type PilotInboxSource = z.infer<typeof pilotInboxSourceSchema>;

// A LINE draft's provenance: 'ai' means the model produced the summary; 'manual'
// means the extraction degraded (AI unavailable) and a human must fill it in. The
// message is never lost either way. Kept strict, mirroring the real draft DTO.
export const pilotInboxOriginSchema = z.enum(["ai", "manual"]);
export type PilotInboxOrigin = z.infer<typeof pilotInboxOriginSchema>;

// UI-facing inbox item. Web rows come from the public intake form (M2/M3); LINE
// rows are intake drafts (M7). A LINE row carries draft-only fields —
// origin/confidence/draftStatus/draftId/conversationId — that drive the
// "待確認 · LINE" badge and route the card to the draft-review screen instead of
// the triage detail. Web rows leave those undefined/null.
export interface PilotInboxItem {
  id: string;
  referenceNo: string;
  source: PilotInboxSource;
  contactName: string;
  contactPhone: string | null;
  serviceName: string | null;
  category: string | null;
  title: string;
  description: string;
  address: string | null;
  photoCount: number;
  status: z.infer<typeof serviceRequestStatusSchema>;
  priority: z.infer<typeof serviceRequestPrioritySchema>;
  lockVersion: number;
  customerId: string | null;
  assignedMemberId: string | null;
  triagedAt: string | null;
  createdAt: string;
  // Draft-only (source === "line"); undefined on web rows.
  origin?: PilotInboxOrigin;
  confidence?: number | null;
  draftStatus?: IntakeDraftStatus;
  draftId?: string;
  conversationId?: string;
}

export function toPilotInboxItem(row: PilotInboxRpcItem): PilotInboxItem {
  return {
    id: row.id,
    referenceNo: row.requestNo,
    source: "web",
    contactName: row.contactName,
    contactPhone: row.contactPhone,
    serviceName: row.serviceName,
    category: row.category,
    title: row.subject,
    description: row.description,
    address: row.address,
    photoCount: row.photoCount,
    status: row.status,
    priority: row.priority,
    lockVersion: row.lockVersion,
    customerId: row.customerId,
    assignedMemberId: row.assignedMemberId,
    triagedAt: row.triagedAt,
    createdAt: row.createdAt,
  };
}

// Map a LINE intake-draft list item (the Wave 2 GET /intake-drafts DTO) onto the
// unified inbox card shape so the pending inbox can show web requests and LINE
// drafts side by side. Draft rows have no phone (contact is a LINE identity) and
// no service-request status; the badge is driven by source/origin/confidence and
// the card links to the draft-review screen keyed by draftId.
export function toPilotInboxItemFromDraft(row: IntakeDraftListItem): PilotInboxItem {
  const title = row.title ?? row.summary ?? "LINE 進件";
  return {
    id: row.id,
    referenceNo: `LINE-${row.lineUserId.slice(-6)}`,
    source: "line",
    contactName: row.lineUserId,
    contactPhone: "",
    serviceName: null,
    category: null,
    title,
    description: row.summary ?? "",
    address: null,
    photoCount: 0,
    status: "new",
    priority: "normal",
    lockVersion: row.lockVersion,
    customerId: null,
    assignedMemberId: null,
    triagedAt: null,
    createdAt: row.createdAt,
    origin: row.origin,
    confidence: row.confidence,
    draftStatus: row.status,
    draftId: row.id,
    conversationId: row.conversationId,
  };
}
