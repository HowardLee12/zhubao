import { z } from "zod";

// Validates the work-order detail JSON returned by create/schedule/get_detail/
// force_complete. It is deliberately permissive on nested optional timestamps
// (nullable) but strict on the envelope so a malformed RPC projection fails loudly
// rather than leaking an unexpected shape to the client.
const nullableIso = z.string().nullable();

const assignmentSchema = z
  .object({
    id: z.uuid(),
    membershipId: z.uuid(),
    memberName: z.string().nullable(),
    duty: z.string(),
    status: z.string(),
    assignedAt: nullableIso,
    acceptedAt: nullableIso,
    declinedAt: nullableIso,
    checkedInAt: nullableIso,
    completedAt: nullableIso,
    cancelledAt: nullableIso,
    declineReason: z.string().nullable(),
    lockVersion: z.number().int(),
  })
  .strict();

const checklistItemSchema = z
  .object({
    id: z.uuid(),
    label: z.string(),
    responseType: z.string(),
    isRequired: z.boolean(),
    evidenceRequired: z.boolean(),
    options: z.unknown(),
    response: z.unknown(),
    completedAt: nullableIso,
    completedByMembershipId: z.uuid().nullable(),
    sortOrder: z.number().int(),
  })
  .strict();

const checklistSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    status: z.string(),
    completedAt: nullableIso,
    completedByMembershipId: z.uuid().nullable(),
    lockVersion: z.number().int(),
    items: z.array(checklistItemSchema),
  })
  .strict();

const photoSchema = z
  .object({
    id: z.uuid(),
    category: z.string(),
    status: z.string(),
    checklistItemId: z.uuid().nullable(),
    storagePath: z.string(),
    mimeType: z.string(),
    byteSize: z.number().int().nullable(),
    width: z.number().int().nullable(),
    height: z.number().int().nullable(),
    sha256: z.string().nullable(),
    caption: z.string().nullable(),
    capturedAt: nullableIso,
    uploadedByMembershipId: z.uuid().nullable(),
    readyAt: nullableIso,
    lockVersion: z.number().int(),
    createdAt: z.string(),
  })
  .strict();

export const workOrderDetailSchema = z
  .object({
    id: z.uuid(),
    organizationId: z.uuid(),
    workOrderNo: z.string(),
    projectId: z.uuid().nullable(),
    serviceRequestId: z.uuid().nullable(),
    customerId: z.uuid(),
    locationId: z.uuid(),
    assetId: z.uuid().nullable(),
    title: z.string(),
    description: z.string().nullable(),
    customerNotes: z.string().nullable(),
    technicianNotes: z.string().nullable(),
    internalNotes: z.string().nullable(),
    completionSummary: z.string().nullable(),
    priority: z.string(),
    status: z.string(),
    scheduledStartAt: nullableIso,
    scheduledEndAt: nullableIso,
    dispatchedAt: nullableIso,
    enRouteAt: nullableIso,
    onSiteAt: nullableIso,
    pausedAt: nullableIso,
    completedAt: nullableIso,
    cancelledAt: nullableIso,
    cancellationReason: z.string().nullable(),
    requiresCustomerSignoff: z.boolean(),
    customerSignedAt: nullableIso,
    lockVersion: z.number().int(),
    createdAt: z.string(),
    updatedAt: z.string(),
    assignments: z.array(assignmentSchema),
    checklists: z.array(checklistSchema),
    photos: z.array(photoSchema),
    replayed: z.boolean().optional(),
  })
  .strict();

export type WorkOrderDetailDto = z.infer<typeof workOrderDetailSchema>;

// Client-facing projection. Strips the raw storage path from photos: clients read
// photo bytes only through the authorized signed-URL route, never by constructing
// a bucket path themselves. sha256 is kept (it is a content fingerprint the client
// uses for upload de-duplication).
export function toClientWorkOrderDetail(detail: WorkOrderDetailDto): WorkOrderDetailDto {
  return {
    ...detail,
    photos: detail.photos.map((photo) => ({ ...photo, storagePath: "" })),
  };
}
