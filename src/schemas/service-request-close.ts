import { z } from "zod";

// Request body for the decline/cancel actions. A reason is mandatory because the
// DB enforces service_requests_close_reason_chk and the transition RPC raises
// CLOSE_REASON_REQUIRED for a blank reason.
export const serviceRequestCloseSchema = z
  .object({
    reason: z.string().trim().min(1).max(2000),
  })
  .strict();

export type ServiceRequestClose = z.infer<typeof serviceRequestCloseSchema>;
