import { z } from "zod";

const occurredAt = z.iso.datetime({ offset: true });

export const createMaintenancePlanSchema = z
  .object({
    customerId: z.uuid(),
    locationId: z.uuid(),
    name: z.string().trim().min(1).max(160),
    cadenceMonths: z.number().int().min(1).max(60),
    nextDueOn: z.iso.date(),
    assetId: z.uuid().nullable().optional(),
    serviceCatalogItemId: z.uuid().nullable().optional(),
    leadDays: z.number().int().min(0).max(90).optional(),
    autoPrepareMessage: z.boolean().optional(),
    occurredAt: occurredAt.optional(),
  })
  .strict();

export type CreateMaintenancePlanInput = z.infer<typeof createMaintenancePlanSchema>;

export const patchMaintenancePlanSchema = z
  .object({
    name: z.string().trim().min(1).max(160).nullable().optional(),
    cadenceMonths: z.number().int().min(1).max(60).nullable().optional(),
    leadDays: z.number().int().min(0).max(90).nullable().optional(),
    nextDueOn: z.iso.date().nullable().optional(),
    autoPrepareMessage: z.boolean().nullable().optional(),
    occurredAt: occurredAt.optional(),
  })
  .strict();

export type PatchMaintenancePlanInput = z.infer<typeof patchMaintenancePlanSchema>;

export const emptyOccurredAtSchema = z
  .object({ occurredAt: occurredAt.optional() })
  .strict();

export const cancelMaintenancePlanSchema = z
  .object({
    reason: z.string().trim().min(1).max(2_000),
    occurredAt: occurredAt.optional(),
  })
  .strict();

export const completeMaintenancePlanSchema = z
  .object({
    completedWorkOrderId: z.uuid().nullable().optional(),
    completedOn: z.iso.date().nullable().optional(),
    occurredAt: occurredAt.optional(),
  })
  .strict();

export type CompleteMaintenancePlanInput = z.infer<typeof completeMaintenancePlanSchema>;

// A revisit reminder is prepared as an approval-pending draft only — it never
// auto-sends. Staff approves it via notifications:approve before it can be claimed.
export const prepareMaintenanceRemindersSchema = z
  .object({
    planIds: z.array(z.uuid()).min(1).max(100),
    occurredAt: occurredAt.optional(),
  })
  .strict();

export type PrepareMaintenanceRemindersInput = z.infer<
  typeof prepareMaintenanceRemindersSchema
>;

export const approveNotificationsSchema = z
  .object({
    notificationIds: z.array(z.uuid()).min(1).max(100),
    occurredAt: occurredAt.optional(),
  })
  .strict();

export type ApproveNotificationsInput = z.infer<typeof approveNotificationsSchema>;

export const convertMaintenancePlanSchema = z
  .object({
    subject: z.string().trim().min(1).max(200).nullable().optional(),
    description: z.string().max(4_000).optional(),
    force: z.boolean().optional(),
    occurredAt: occurredAt.optional(),
  })
  .strict();

export type ConvertMaintenancePlanInput = z.infer<typeof convertMaintenancePlanSchema>;

export const listMaintenancePlansQuerySchema = z
  .object({
    status: z
      .enum(["active", "paused", "completed", "cancelled"])
      .nullable()
      .optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
  })
  .strict();

export type ListMaintenancePlansQuery = z.infer<typeof listMaintenancePlansQuerySchema>;
