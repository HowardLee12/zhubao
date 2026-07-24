import { describe, expect, it } from "vitest";

import { eventRowSchema, toEventDto } from "./service-request-event";

describe("service request event DTO", () => {
  const row = {
    id: "e0000000-0000-4000-8000-000000000001",
    event_type: "service_request.triaged",
    actor_type: "user",
    actor_user_id: "10000000-0000-4000-8000-000000000002",
    occurred_at: "2026-07-17T00:00:00.000Z",
    chain_sequence: 2,
    payload: { from: "new", to: "triaged" },
  };

  it("maps an event row to a camelCase timeline DTO", () => {
    expect(toEventDto(eventRowSchema.parse(row))).toEqual({
      id: "e0000000-0000-4000-8000-000000000001",
      eventType: "service_request.triaged",
      actorType: "user",
      actorUserId: "10000000-0000-4000-8000-000000000002",
      occurredAt: "2026-07-17T00:00:00.000Z",
      chainSequence: 2,
      payload: { from: "new", to: "triaged" },
    });
  });

  it("redacts the raw submission blob from a public_submitted event payload", () => {
    const dto = toEventDto(
      eventRowSchema.parse({
        ...row,
        event_type: "service_request.public_submitted",
        actor_type: "system",
        actor_user_id: null,
        chain_sequence: 1,
        payload: {
          requestNo: "SR-202607-000001",
          submission: { contactPhone: "+886912345678", address: { addressLine: "秘密路" } },
        },
      }),
    );
    expect(dto.payload).toEqual({ requestNo: "SR-202607-000001" });
    expect(JSON.stringify(dto)).not.toContain("+886912345678");
  });
});
