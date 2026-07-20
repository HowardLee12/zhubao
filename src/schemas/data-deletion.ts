import { z } from "zod";

const occurredAt = z.iso.datetime({ offset: true });

// Owner-only pilot data deletion. The owner re-authenticates and the route hashes
// the confirmation material to a hex digest that the RPC stores and later compares
// on finalize. The raw password/token never reaches the RPC.
export const requestDataDeletionSchema = z
  .object({
    reauthToken: z.string().min(8).max(4_096),
    occurredAt: occurredAt.optional(),
  })
  .strict();

export type RequestDataDeletionInput = z.infer<typeof requestDataDeletionSchema>;

export const finalizeDataDeletionSchema = z
  .object({
    deletionRequestId: z.uuid(),
    reauthToken: z.string().min(8).max(4_096),
    occurredAt: occurredAt.optional(),
  })
  .strict();

export type FinalizeDataDeletionInput = z.infer<typeof finalizeDataDeletionSchema>;
