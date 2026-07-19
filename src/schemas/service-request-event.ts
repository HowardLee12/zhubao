import { z } from "zod";

// Append-only timeline event DTO for a service request. Read under the
// auditor-scoped RLS SELECT policy. The public_submitted event carries a full
// raw `submission` blob (phone/address) as a second copy of intake intent; the
// timeline redacts it because the canonical original submission is already shown
// on the detail view and the timeline is visible to broader auditor roles.
export const eventRowSchema = z
  .object({
    id: z.uuid(),
    event_type: z.string().min(1).max(160),
    actor_type: z.enum(["user", "customer", "system", "line"]),
    actor_user_id: z.uuid().nullable(),
    occurred_at: z.iso.datetime({ offset: true }),
    chain_sequence: z.number().int().min(1),
    payload: z.record(z.string(), z.unknown()),
  })
  .strict();

export type EventRow = z.infer<typeof eventRowSchema>;

export interface ServiceRequestEventDto {
  id: string;
  eventType: string;
  actorType: string;
  actorUserId: string | null;
  occurredAt: string;
  chainSequence: number;
  payload: Record<string, unknown>;
}

export function toEventDto(row: EventRow): ServiceRequestEventDto {
  // Strip the raw `submission` blob (phone/address) from the timeline payload.
  const safePayload = { ...row.payload };
  delete safePayload.submission;
  return {
    id: row.id,
    eventType: row.event_type,
    actorType: row.actor_type,
    actorUserId: row.actor_user_id,
    occurredAt: row.occurred_at,
    chainSequence: row.chain_sequence,
    payload: safePayload,
  };
}
