import { z } from "zod";

// The AI-extractor contract. An extractor turns an aggregated LINE conversation
// into a STRUCTURED DRAFT — never an action. Per the product rule (CLAUDE.md) the
// output is only ever a draft a human confirms; nothing here quotes, dispatches or
// notifies. The shape mirrors what mark_extraction_succeeded persists so the
// worker can hand the result straight to the DB without reshaping.

// Where a single extracted field's value came from. 'line' = verbatim from the
// customer's message, 'ai' = inferred/normalised by the model, 'manual' = a human
// filled it in later. Provenance is preserved end-to-end so the reviewer can see
// which fields the AI guessed.
export const extractionFieldSourceSchema = z.enum(["line", "ai", "manual"]);
export type ExtractionFieldSource = z.infer<typeof extractionFieldSourceSchema>;

// One extracted field: the value plus its provenance and per-field confidence.
export const extractionFieldSchema = z
  .object({
    value: z.string().max(4000),
    source: extractionFieldSourceSchema,
    confidence: z.number().min(0).max(1).nullable(),
  })
  .strict();
export type ExtractionField = z.infer<typeof extractionFieldSchema>;

// The per-field map. Keys are open (contactName / subject / description / phone /
// address / serviceType …) so a template can add fields without a schema change;
// each value carries its own provenance.
export const extractionFieldsSchema = z.record(z.string().min(1).max(80), extractionFieldSchema);
export type ExtractionFields = z.infer<typeof extractionFieldsSchema>;

// The extractor's input: the aggregated conversation text, optional attachment
// descriptors, and the inbound_messages ids the text/attachments were built from
// (echoed back as usedMessageIds so the run audit records exactly what was read).
export const extractionInputSchema = z
  .object({
    conversationText: z.string().max(40000),
    attachments: z
      .array(
        z
          .object({
            messageId: z.uuid(),
            kind: z.literal("image"),
            storagePath: z.string().min(1).max(1000).nullable(),
          })
          .strict(),
      )
      .max(50)
      .optional(),
    messageIds: z.array(z.uuid()).max(500),
  })
  .strict();
export type ExtractionInput = z.infer<typeof extractionInputSchema>;

// The extractor's output: a draft summary + title, the per-field map, the list of
// fields the model could not fill (missing), the message ids it actually used, and
// an overall confidence. Validated at the seam boundary so a malformed model
// response is caught as a failure (degrading to a manual draft) rather than
// persisted.
export const extractionResultSchema = z
  .object({
    summary: z.string().max(4000).nullable(),
    title: z.string().max(160).nullable(),
    fields: extractionFieldsSchema,
    missingFields: z.array(z.string().min(1).max(80)).max(50),
    usedMessageIds: z.array(z.uuid()).max(500),
    overallConfidence: z.number().min(0).max(1).nullable(),
  })
  .strict();
export type ExtractionResult = z.infer<typeof extractionResultSchema>;
