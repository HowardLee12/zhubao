import { describe, expect, it } from "vitest";

import {
  scheduleConflictsCheckSchema,
  workOrderScheduleSchema,
} from "./work-order-schedule";

const validSchedule = {
  scheduledStartAt: "2026-08-01T01:00:00+00:00",
  scheduledEndAt: "2026-08-01T03:00:00+00:00",
  occurredAt: "2026-08-01T00:30:00+00:00",
  assignments: [{ membershipId: "30000000-0000-4000-8000-000000000003" }],
};

describe("workOrderScheduleSchema", () => {
  it("accepts a valid schedule with a default-duty assignment", () => {
    expect(workOrderScheduleSchema.safeParse(validSchedule).success).toBe(true);
  });

  it("requires at least one assignment and caps at 20", () => {
    expect(workOrderScheduleSchema.safeParse({ ...validSchedule, assignments: [] }).success).toBe(
      false,
    );
    const many = Array.from({ length: 21 }, () => ({
      membershipId: "30000000-0000-4000-8000-000000000003",
    }));
    expect(workOrderScheduleSchema.safeParse({ ...validSchedule, assignments: many }).success).toBe(
      false,
    );
  });

  it("rejects an unknown duty", () => {
    expect(
      workOrderScheduleSchema.safeParse({
        ...validSchedule,
        assignments: [{ membershipId: "30000000-0000-4000-8000-000000000003", duty: "boss" }],
      }).success,
    ).toBe(false);
  });
});

describe("scheduleConflictsCheckSchema", () => {
  it("caps membershipIds at 50", () => {
    const ids = Array.from({ length: 51 }, () => "30000000-0000-4000-8000-000000000003");
    expect(
      scheduleConflictsCheckSchema.safeParse({
        membershipIds: ids,
        startsAt: "2026-08-01T01:00:00+00:00",
        endsAt: "2026-08-01T03:00:00+00:00",
      }).success,
    ).toBe(false);
  });
});
