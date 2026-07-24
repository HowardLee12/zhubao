import { z } from "zod";

const occurredAt = z.iso.datetime({ offset: true });
const nullableOverrideReason = z.string().trim().min(1).max(2_000).nullable().optional();

const simpleTransitionSchema = z
  .object({
    action: z.enum(["dispatch", "enRoute", "arrive", "pause", "resume"]),
    occurredAt,
    overrideReason: nullableOverrideReason,
  })
  .strict();

// The schedule action carries the planned window the work-order domain reads
// from facts (scheduledStartAt/scheduledEndAt). It is modelled here so the input
// contract can express every WORK_ORDER_ACTIONS value; the window is validated
// again in decideWorkOrderTransition.
const scheduleTransitionSchema = z
  .object({
    action: z.literal("schedule"),
    occurredAt,
    scheduledStartAt: occurredAt,
    scheduledEndAt: occurredAt,
    overrideReason: nullableOverrideReason,
  })
  .strict();

const completeTransitionSchema = z
  .object({
    action: z.literal("complete"),
    occurredAt,
    completionSummary: z.string().trim().min(1).max(10_000),
    customerSignoffName: z.string().trim().min(1).max(120).nullable(),
    overrideReason: nullableOverrideReason,
  })
  .strict();

const cancelTransitionSchema = z
  .object({
    action: z.literal("cancel"),
    occurredAt,
    reason: z.string().trim().min(1).max(2_000),
    overrideReason: nullableOverrideReason,
  })
  .strict();

const reopenTransitionSchema = z
  .object({
    action: z.literal("reopen"),
    occurredAt,
    reason: z.string().trim().min(1).max(2_000),
    overrideReason: nullableOverrideReason,
  })
  .strict();

export const workOrderTransitionSchema = z.discriminatedUnion("action", [
  simpleTransitionSchema,
  scheduleTransitionSchema,
  completeTransitionSchema,
  cancelTransitionSchema,
  reopenTransitionSchema,
]);

export type WorkOrderTransitionInput = z.infer<typeof workOrderTransitionSchema>;
