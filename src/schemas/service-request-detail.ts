import { z } from "zod";

// Service request detail DTO for the triage workspace. A manager-scoped RPC
// projects this exact allowlist and the mapper produces the canonical camelCase
// DTO. subject is canonical and title is a deprecated alias that always mirrors
// subject. original_submission is staff-only immutable intake evidence.

export const serviceRequestDetailRowSchema = z
  .object({
    id: z.uuid(),
    request_no: z.string().min(1).max(40),
    customer_id: z.uuid().nullable(),
    location_id: z.uuid().nullable(),
    asset_id: z.uuid().nullable(),
    source: z.enum(["line", "phone", "web", "referral", "manual"]),
    status: z.enum([
      "new",
      "triaged",
      "quoting",
      "quoted",
      "converted",
      "declined",
      "cancelled",
    ]),
    priority: z.enum(["low", "normal", "high", "urgent"]),
    category: z.string().min(1).max(100).nullable(),
    subject: z.string().min(1).max(160),
    description: z.string().max(10_000),
    contact_name: z.string().min(1).max(120),
    contact_phone: z
      .string()
      .regex(/^\+[1-9][0-9]{7,14}$/)
      .nullable(),
    contact_email: z.string().max(254).nullable(),
    assigned_member_id: z.uuid().nullable(),
    triaged_at: z.iso.datetime({ offset: true }).nullable(),
    converted_at: z.iso.datetime({ offset: true }).nullable(),
    converted_project_id: z.uuid().nullable(),
    converted_work_order_id: z.uuid().nullable(),
    converted_project_no: z.string().max(40).nullable(),
    converted_work_order_no: z.string().max(40).nullable(),
    decline_reason: z.string().nullable(),
    cancellation_reason: z.string().nullable(),
    internal_note: z.string().max(2000),
    original_submission: z.record(z.string(), z.unknown()).nullable(),
    summary_edited_by: z.uuid().nullable(),
    summary_edited_at: z.iso.datetime({ offset: true }).nullable(),
    lock_version: z.number().int().min(1),
    created_at: z.iso.datetime({ offset: true }),
    updated_at: z.iso.datetime({ offset: true }),
  })
  .strict();

export type ServiceRequestDetailRow = z.infer<typeof serviceRequestDetailRowSchema>;

export const timeWindowRowSchema = z
  .object({
    starts_at: z.iso.datetime({ offset: true }),
    ends_at: z.iso.datetime({ offset: true }),
    preference_rank: z.number().int().min(1).max(5),
  })
  .strict();

export type TimeWindowRow = z.infer<typeof timeWindowRowSchema>;

// The authenticated detail RPC returns private storage metadata only to the
// trusted Next.js server. The HTTP mapper replaces storage_path with a
// short-lived signed URL before anything reaches the browser.
export const photoMetadataRowSchema = z
  .object({
    id: z.uuid(),
    category: z.string().min(1).max(40),
    storage_path: z.string().min(1).max(1000),
  })
  .strict();

export type PhotoMetadataRow = z.infer<typeof photoMetadataRowSchema>;

export const serviceRequestWorkspaceRpcSchema = z
  .object({
    request: serviceRequestDetailRowSchema,
    windows: z.array(timeWindowRowSchema),
    photos: z.array(photoMetadataRowSchema),
  })
  .strict();

export type ServiceRequestWorkspaceRpc = z.infer<
  typeof serviceRequestWorkspaceRpcSchema
>;

export interface DetailPhoto {
  id: string;
  category: string;
  url: string;
  expiresAt: string;
}

export interface PreferredWindowDto {
  startsAt: string;
  endsAt: string;
  preferenceRank: number;
}

export interface ServiceRequestDetail {
  id: string;
  requestNo: string;
  customerId: string | null;
  locationId: string | null;
  assetId: string | null;
  source: string;
  status: string;
  priority: string;
  category: string | null;
  subject: string;
  // Deprecated alias, always mirrors subject.
  title: string;
  description: string;
  contactName: string;
  contactPhone: string | null;
  contactEmail: string | null;
  assignedMemberId: string | null;
  triagedAt: string | null;
  convertedAt: string | null;
  convertedProjectId: string | null;
  convertedWorkOrderId: string | null;
  convertedProjectNo: string | null;
  convertedWorkOrderNo: string | null;
  declineReason: string | null;
  cancellationReason: string | null;
  internalNote: string;
  originalSubmission: Record<string, unknown> | null;
  summaryEditedBy: string | null;
  summaryEditedAt: string | null;
  preferredWindows: PreferredWindowDto[];
  photos: DetailPhoto[];
  lockVersion: number;
  createdAt: string;
  updatedAt: string;
}

export function toServiceRequestDetail(
  row: ServiceRequestDetailRow,
  windows: TimeWindowRow[],
  photos: DetailPhoto[],
): ServiceRequestDetail {
  return {
    id: row.id,
    requestNo: row.request_no,
    customerId: row.customer_id,
    locationId: row.location_id,
    assetId: row.asset_id,
    source: row.source,
    status: row.status,
    priority: row.priority,
    category: row.category,
    subject: row.subject,
    title: row.subject,
    description: row.description,
    contactName: row.contact_name,
    contactPhone: row.contact_phone,
    contactEmail: row.contact_email,
    assignedMemberId: row.assigned_member_id,
    triagedAt: row.triaged_at,
    convertedAt: row.converted_at,
    convertedProjectId: row.converted_project_id,
    convertedWorkOrderId: row.converted_work_order_id,
    convertedProjectNo: row.converted_project_no,
    convertedWorkOrderNo: row.converted_work_order_no,
    declineReason: row.decline_reason,
    cancellationReason: row.cancellation_reason,
    internalNote: row.internal_note,
    originalSubmission: row.original_submission,
    summaryEditedBy: row.summary_edited_by,
    summaryEditedAt: row.summary_edited_at,
    preferredWindows: windows.map((window) => ({
      startsAt: window.starts_at,
      endsAt: window.ends_at,
      preferenceRank: window.preference_rank,
    })),
    photos,
    lockVersion: row.lock_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// PATCH body for content-only edits (never status). At least one field. subject
// is canonical; title is accepted as a deprecated alias and normalized to
// subject. Editing any of these fields stamps summary-edit provenance server-side.
export const serviceRequestPatchSchema = z
  .object({
    subject: z.string().min(1).max(160).optional(),
    title: z.string().min(1).max(160).optional(),
    description: z.string().max(10_000).optional(),
    priority: z.enum(["low", "normal", "high", "urgent"]).nullable().optional(),
    category: z.string().min(1).max(100).nullable().optional(),
    contactName: z.string().min(1).max(120).optional(),
    contactPhone: z
      .string()
      .regex(/^\+[1-9][0-9]{7,14}$/)
      .nullable()
      .optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "至少需要一個要更新的欄位。",
  });

export type ServiceRequestPatch = z.infer<typeof serviceRequestPatchSchema>;
