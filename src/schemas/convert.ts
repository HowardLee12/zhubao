import { z } from "zod";

// Request body for POST .../service-requests/:id/actions/convert. The optimistic
// lock version arrives in the If-Match header and the Idempotency-Key header is
// mandatory at the route; neither belongs in the body. workOrder is the single
// canonical input for both modes: singleVisit creates only a work order, project
// creates a project and optionally an initial work order. Assignment is not
// accepted until the conversion transaction can persist it; silently accepting
// a field that the database ignores would create a false-success contract.
const convertWorkOrderSchema = z
  .object({
    title: z.string().min(1).max(200),
    scheduledStartAt: z.iso.datetime({ offset: true }).nullable().optional(),
    scheduledEndAt: z.iso.datetime({ offset: true }).nullable().optional(),
  })
  .strict();

export const convertRequestSchema = z
  .object({
    mode: z.enum(["singleVisit", "project"]),
    projectTitle: z.string().min(1).max(200).optional(),
    workOrder: convertWorkOrderSchema.optional(),
  })
  .strict();

export type ConvertRequest = z.infer<typeof convertRequestSchema>;

// The convert_service_request RPC returns a jsonb ConversionEnvelope with
// camelCase keys already. The route validates it before returning so a malformed
// RPC payload fails loudly rather than leaking an unexpected shape.
const envelopeServiceRequestSchema = z
  .object({
    id: z.uuid(),
    status: z.literal("converted"),
    lockVersion: z.number().int().min(1),
    convertedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

const envelopeProjectSchema = z
  .object({
    id: z.uuid(),
    projectNo: z.string().min(1).max(40),
    name: z.string().min(1).max(200),
    status: z.string().min(1).max(40),
  })
  .strict();

const envelopeWorkOrderSchema = z
  .object({
    id: z.uuid(),
    workOrderNo: z.string().min(1).max(40),
    title: z.string().min(1).max(200),
    status: z.string().min(1).max(40),
  })
  .strict();

export const conversionEnvelopeSchema = z
  .object({
    serviceRequest: envelopeServiceRequestSchema,
    project: envelopeProjectSchema.nullable(),
    workOrder: envelopeWorkOrderSchema.nullable(),
    replayed: z.boolean(),
  })
  .strict();

export type ConversionEnvelope = z.infer<typeof conversionEnvelopeSchema>;
