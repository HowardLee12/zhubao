import { z } from "zod";

const occurredAt = z.iso.datetime({ offset: true });

// Payment is TRACKING ONLY. amount_minor is an integer minor unit (e.g. TWD cents
// are not used; TWD tracks whole NTD in minor units per the org convention). The
// create body validates the amount as a positive integer; the RPC re-enforces it.
export const createPaymentMilestoneSchema = z
  .object({
    projectId: z.uuid(),
    name: z.string().trim().min(1).max(120),
    amountMinor: z.number().int().positive(),
    dueOn: z.iso.date().nullable().optional(),
    quoteVersionId: z.uuid().nullable().optional(),
    changeOrderId: z.uuid().nullable().optional(),
    currency: z.enum(["TWD"]).optional(),
    notes: z.string().max(2_000).optional(),
    occurredAt: occurredAt.optional(),
  })
  .strict();

export type CreatePaymentMilestoneInput = z.infer<typeof createPaymentMilestoneSchema>;

export const invoicePaymentMilestoneSchema = z
  .object({
    dueOn: z.iso.date().nullable().optional(),
    occurredAt: occurredAt.optional(),
  })
  .strict();

export type InvoicePaymentMilestoneInput = z.infer<typeof invoicePaymentMilestoneSchema>;

// mark-paid is tracking only and MUST NOT accept a payment gateway. The DB layer
// screens metadata/method/reference for card/CVV/bank-secret-looking fields and
// rejects with 422; the Zod layer keeps the surface small.
export const markPaymentMilestonePaidSchema = z
  .object({
    paymentMethod: z.string().max(60).nullable().optional(),
    externalReference: z.string().max(120).nullable().optional(),
    paidAt: occurredAt.nullable().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    occurredAt: occurredAt.optional(),
  })
  .strict();

export type MarkPaymentMilestonePaidInput = z.infer<typeof markPaymentMilestonePaidSchema>;

const reasonBodySchema = z
  .object({
    reason: z.string().trim().min(1).max(2_000),
    occurredAt: occurredAt.optional(),
  })
  .strict();

export const waivePaymentMilestoneSchema = reasonBodySchema;
export const cancelPaymentMilestoneSchema = reasonBodySchema;
export const reversePaymentMilestoneSchema = reasonBodySchema;

export type ReasonPaymentMilestoneInput = z.infer<typeof reasonBodySchema>;

export const listPaymentMilestonesQuerySchema = z
  .object({
    projectId: z.uuid().nullable().optional(),
    status: z
      .enum(["pending", "invoiced", "overdue", "paid", "waived", "cancelled"])
      .nullable()
      .optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
  })
  .strict();

export type ListPaymentMilestonesQuery = z.infer<typeof listPaymentMilestonesQuerySchema>;
