import { z } from "zod";

const duty = z.enum(["lead", "technician", "helper", "observer"]);

// POST .../work-orders/:id/assignments — create a single assignment.
export const assignmentCreateSchema = z
  .object({
    membershipId: z.uuid(),
    duty,
  })
  .strict();

export type AssignmentCreateInput = z.infer<typeof assignmentCreateSchema>;

// PATCH .../assignments/:assignmentId — change duty (If-Match on the assignment).
export const assignmentUpdateSchema = z
  .object({
    duty,
  })
  .strict();

export type AssignmentUpdateInput = z.infer<typeof assignmentUpdateSchema>;

// DELETE .../assignments/:assignmentId — soft-cancel; reason is mandatory and is
// carried in the body because DELETE has no natural payload otherwise.
export const assignmentCancelSchema = z
  .object({
    reason: z.string().trim().min(1).max(2_000),
  })
  .strict();

export type AssignmentCancelInput = z.infer<typeof assignmentCancelSchema>;

// POST .../assignments/:assignmentId/actions/respond — technician self decision.
export const assignmentRespondSchema = z
  .discriminatedUnion("decision", [
    z.object({ decision: z.literal("accept") }).strict(),
    z
      .object({
        decision: z.literal("decline"),
        reason: z.string().trim().min(1).max(2_000),
      })
      .strict(),
  ]);

export type AssignmentRespondInput = z.infer<typeof assignmentRespondSchema>;

// Validates the assignment JSON returned by create/update/cancel/respond RPCs.
const nullableIso = z.string().nullable();
export const assignmentDtoSchema = z
  .object({
    id: z.uuid(),
    organizationId: z.uuid(),
    workOrderId: z.uuid(),
    membershipId: z.uuid(),
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
    replayed: z.boolean().optional(),
  })
  .strict();

export type AssignmentDto = z.infer<typeof assignmentDtoSchema>;
