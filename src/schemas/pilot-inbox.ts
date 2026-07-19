import { z } from "zod";

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

// Mirrors the list_pilot_service_requests RPC row shape exactly (SQL is the
// pgTAP-pinned source of truth). It is intentionally strict so any drift or an
// internal column leaking into the projection fails loudly.
const pilotInboxRpcItemSchema = z
  .object({
    id: z.uuid(),
    requestNo: z.string().min(1).max(40),
    contactName: z.string().min(1).max(120),
    contactPhone: z.string().regex(/^\+[1-9][0-9]{7,14}$/),
    subject: z.string().min(1).max(160),
    description: z.string().max(10_000),
    status: serviceRequestStatusSchema,
    priority: serviceRequestPrioritySchema,
    serviceCatalogItemId: z.uuid().nullable(),
    serviceName: z.string().min(1).max(120).nullable(),
    category: z.string().min(1).max(120).nullable(),
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

// UI-facing inbox item. All pilot inbox rows currently originate from the public
// web intake form, so source is fixed to "web".
export interface PilotInboxItem {
  id: string;
  referenceNo: string;
  source: "web";
  contactName: string;
  contactPhone: string;
  serviceName: string | null;
  category: string | null;
  title: string;
  description: string;
  address: string | null;
  photoCount: number;
  status: z.infer<typeof serviceRequestStatusSchema>;
  priority: z.infer<typeof serviceRequestPrioritySchema>;
  createdAt: string;
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
    createdAt: row.createdAt,
  };
}
