import { describe, expect, it } from "vitest";

import {
  assignmentCancelSchema,
  assignmentCreateSchema,
  assignmentRespondSchema,
} from "./assignment";

describe("assignment schemas", () => {
  it("accepts a valid create", () => {
    expect(
      assignmentCreateSchema.safeParse({
        membershipId: "30000000-0000-4000-8000-000000000003",
        duty: "lead",
      }).success,
    ).toBe(true);
  });

  it("requires a reason to cancel", () => {
    expect(assignmentCancelSchema.safeParse({ reason: "" }).success).toBe(false);
    expect(assignmentCancelSchema.safeParse({ reason: "客戶取消" }).success).toBe(true);
  });

  it("requires a reason only when declining", () => {
    expect(assignmentRespondSchema.safeParse({ decision: "accept" }).success).toBe(true);
    expect(assignmentRespondSchema.safeParse({ decision: "decline" }).success).toBe(false);
    expect(
      assignmentRespondSchema.safeParse({ decision: "decline", reason: "臨時有事" }).success,
    ).toBe(true);
  });
});
