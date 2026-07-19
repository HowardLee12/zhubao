import { z } from "zod";

const POSTGRES_BIGINT_MAX = BigInt("9223372036854775807");

export const moneyMinorSchema = z
  .string()
  .regex(/^\d+$/, "金額必須是非負整數字串。")
  .refine(
    (value) => !/^\d+$/.test(value) || BigInt(value) <= POSTGRES_BIGINT_MAX,
    "金額超出允許範圍。",
  );

export const quantitySchema = z
  .string()
  .regex(/^(?:0|[1-9]\d*)(?:\.\d{1,3})?$/, "數量最多只能有三位小數。")
  .refine((value) => Number(value) > 0, "數量必須大於零。");

export const taxRateSchema = z
  .string()
  .regex(/^(?:0(?:\.\d{1,4})?|1(?:\.0{1,4})?)$/, "稅率必須介於 0 與 1 之間，最多四位小數。");

export const quoteItemInputSchema = z
  .object({
    serviceCatalogItemId: z.uuid().nullable().default(null),
    groupName: z.string().max(120).default(""),
    name: z.string().trim().min(1).max(300),
    specification: z.string().max(5_000).default(""),
    unit: z.string().trim().min(1).max(20),
    quantity: quantitySchema,
    unitCostMinor: moneyMinorSchema,
    unitPriceMinor: moneyMinorSchema,
    discountMinor: moneyMinorSchema,
    taxRate: taxRateSchema,
    sortOrder: z.number().int().min(0).max(100_000),
  })
  .strict();

export const quoteDraftSchema = z
  .object({
    title: z.string().trim().min(1).max(160),
    validUntil: z.iso.date().nullable(),
    customerNotes: z.string().max(10_000).default(""),
    internalNotes: z.string().max(10_000).default(""),
    terms: z.string().max(10_000).default(""),
    items: z.array(quoteItemInputSchema).min(1).max(300),
  })
  .strict();

export const createQuoteSchema = z
  .object({
    serviceRequestId: z.uuid(),
    customerId: z.uuid(),
    locationId: z.uuid(),
    currency: z.literal("TWD").default("TWD"),
    version: quoteDraftSchema,
  })
  .strict();

export const sendQuoteSchema = z
  .object({
    versionId: z.uuid(),
    serviceRequestLockVersion: z.number().int().min(1),
  })
  .strict();

export const cloneQuoteVersionSchema = z
  .object({
    cloneFromVersionId: z.uuid(),
  })
  .strict();

export const publicQuoteResponseSchema = z
  .object({
    decision: z.enum(["accept", "reject"]),
    displayName: z.string().trim().min(1).max(120),
    comment: z.string().trim().max(2_000).nullable().default(null),
  })
  .strict();

const quoteItemSchema = quoteItemInputSchema.extend({
  id: z.uuid(),
  subtotalMinor: moneyMinorSchema,
  taxMinor: moneyMinorSchema,
  totalMinor: moneyMinorSchema,
});

const quoteVersionSchema = z
  .object({
    id: z.uuid(),
    quoteId: z.uuid(),
    versionNo: z.number().int().min(1),
    status: z.enum([
      "draft",
      "sent",
      "superseded",
      "accepted",
      "rejected",
      "expired",
      "cancelled",
    ]),
    approvalStatus: z.enum([
      "not_submitted",
      "pending",
      "approved",
      "changes_requested",
    ]),
    title: z.string().min(1).max(160),
    validUntil: z.iso.date().nullable(),
    customerNotes: z.string().max(10_000),
    internalNotes: z.string().max(10_000),
    terms: z.string().max(10_000),
    subtotalMinor: moneyMinorSchema,
    discountMinor: moneyMinorSchema,
    taxMinor: moneyMinorSchema,
    totalMinor: moneyMinorSchema,
    items: z.array(quoteItemSchema).max(300),
    createdAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

const quoteAggregateSchema = z
  .object({
    id: z.uuid(),
    quoteNo: z.string().min(1).max(40),
    serviceRequestId: z.uuid(),
    customerId: z.uuid(),
    locationId: z.uuid(),
    status: z.enum(["draft", "sent", "viewed", "accepted", "rejected", "expired", "cancelled"]),
    currency: z.literal("TWD"),
    latestVersionId: z.uuid(),
    activeVersionId: z.uuid().nullable(),
    acceptedVersionId: z.uuid().nullable(),
    sentAt: z.iso.datetime({ offset: true }).nullable(),
    firstViewedAt: z.iso.datetime({ offset: true }).nullable(),
    acceptedAt: z.iso.datetime({ offset: true }).nullable(),
    rejectedAt: z.iso.datetime({ offset: true }).nullable(),
    rejectionReason: z.string().nullable(),
    expiresAt: z.iso.datetime({ offset: true }).nullable(),
    lockVersion: z.number().int().min(1),
    createdAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export const quoteWorkspaceSchema = z
  .object({
    quote: quoteAggregateSchema,
    version: quoteVersionSchema,
    request: z
      .object({
        id: z.uuid(),
        requestNo: z.string().min(1).max(40),
        subject: z.string().min(1).max(160),
        status: z.enum(["triaged", "quoting", "quoted", "converted", "declined", "cancelled"]),
        lockVersion: z.number().int().min(1),
      })
      .strict(),
    customer: z
      .object({
        id: z.uuid(),
        name: z.string().min(1).max(120),
        phone: z.string().nullable(),
      })
      .strict(),
    location: z
      .object({
        id: z.uuid(),
        label: z.string().min(1).max(80),
        address: z.string().min(1).max(600),
      })
      .strict(),
    replayed: z.boolean().optional(),
  })
  .strict();

const publicQuoteItemSchema = z
  .object({
    name: z.string().min(1).max(300),
    specification: z.string().max(5_000),
    unit: z.string().min(1).max(20),
    quantity: quantitySchema,
    unitPriceMinor: moneyMinorSchema,
    discountMinor: moneyMinorSchema,
    totalMinor: moneyMinorSchema,
  })
  .strict();

export const publicDecisionRecordSchema = z
  .object({
    decision: z.enum(["accept", "reject"]),
    recordedAt: z.iso.datetime({ offset: true }),
    displayName: z.string().min(1).max(120),
    comment: z.string().max(2_000).nullable(),
    replayed: z.boolean(),
  })
  .strict();

export const publicQuoteSchema = z
  .object({
    merchant: z
      .object({
        name: z.string().min(1).max(120),
        phone: z.string().nullable(),
      })
      .strict(),
    quoteNo: z.string().min(1).max(40),
    versionNo: z.number().int().min(1),
    status: z.enum(["sent", "viewed", "accepted", "rejected", "expired", "cancelled"]),
    validUntil: z.iso.date().nullable(),
    title: z.string().min(1).max(160),
    items: z.array(publicQuoteItemSchema).min(1).max(300),
    subtotalMinor: moneyMinorSchema,
    discountMinor: moneyMinorSchema,
    taxMinor: moneyMinorSchema,
    totalMinor: moneyMinorSchema,
    currency: z.literal("TWD"),
    customerNotes: z.string().max(10_000),
    terms: z.string().max(10_000),
    decision: publicDecisionRecordSchema.omit({ replayed: true }).nullable(),
  })
  .strict();

export type QuoteDraftInput = z.infer<typeof quoteDraftSchema>;
export type CreateQuoteInput = z.infer<typeof createQuoteSchema>;
export type QuoteWorkspace = z.infer<typeof quoteWorkspaceSchema>;
export type PublicQuote = z.infer<typeof publicQuoteSchema>;
export type PublicQuoteResponse = z.infer<typeof publicQuoteResponseSchema>;
export type PublicDecisionRecord = z.infer<typeof publicDecisionRecordSchema>;
