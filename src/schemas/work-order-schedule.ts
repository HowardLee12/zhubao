import { z } from "zod";

const occurredAt = z.iso.datetime({ offset: true });

const scheduleAssignmentSchema = z
  .object({
    membershipId: z.uuid(),
    duty: z.enum(["lead", "technician", "helper", "observer"]).optional(),
  })
  .strict();

// Request body for POST .../work-orders/:id/actions/schedule. The If-Match header
// carries the expected work-order lock version. The schedule window plus the
// assignment roster are written atomically with the draft -> scheduled transition
// by schedule_work_order. conflictOverrideReason is only honoured for owner/admin.
export const workOrderScheduleSchema = z
  .object({
    scheduledStartAt: occurredAt,
    scheduledEndAt: occurredAt,
    occurredAt,
    assignments: z.array(scheduleAssignmentSchema).min(1).max(20),
    conflictOverrideReason: z.string().trim().min(1).max(2_000).nullable().optional(),
  })
  .strict();

export type WorkOrderScheduleInput = z.infer<typeof workOrderScheduleSchema>;

// Request body for POST .../schedule/conflicts:check. Bounded batch of candidate
// members over a window, optionally excluding the work order being (re)scheduled.
export const scheduleConflictsCheckSchema = z
  .object({
    membershipIds: z.array(z.uuid()).min(1).max(50),
    startsAt: occurredAt,
    endsAt: occurredAt,
    excludeWorkOrderId: z.uuid().nullable().optional(),
  })
  .strict();

export type ScheduleConflictsCheckInput = z.infer<typeof scheduleConflictsCheckSchema>;
