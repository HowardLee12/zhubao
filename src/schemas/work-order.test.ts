import { describe, expect, it } from "vitest";

import { WORK_ORDER_ACTIONS } from "@/server/domain/work-orders/work-order-state";

import { workOrderTransitionSchema } from "./work-order";

describe("workOrderTransitionSchema", () => {
  it("accepts every action the work-order domain state machine defines", () => {
    const schemaActions = new Set(
      workOrderTransitionSchema.options.flatMap((option) => {
        const action = option.shape.action;
        return "value" in action ? [action.value] : [...action.options];
      }),
    );

    for (const action of WORK_ORDER_ACTIONS) {
      expect(schemaActions.has(action)).toBe(true);
    }
  });

  it("accepts the schedule action with a required time window", () => {
    expect(
      workOrderTransitionSchema.parse({
        action: "schedule",
        occurredAt: "2026-07-18T04:10:00Z",
        scheduledStartAt: "2026-07-19T01:00:00Z",
        scheduledEndAt: "2026-07-19T03:00:00Z",
        overrideReason: null,
      }),
    ).toMatchObject({ action: "schedule" });
  });

  it("rejects a schedule action without a time window", () => {
    expect(
      workOrderTransitionSchema.safeParse({
        action: "schedule",
        occurredAt: "2026-07-18T04:10:00Z",
      }).success,
    ).toBe(false);
  });

  it("accepts the documented complete action", () => {
    expect(
      workOrderTransitionSchema.parse({
        action: "complete",
        occurredAt: "2026-07-18T04:10:00Z",
        completionSummary: "完成清洗與排水測試，運轉正常",
        customerSignoffName: "王先生",
        overrideReason: null,
      }),
    ).toMatchObject({ action: "complete" });
  });

  it("does not let the client provide a target status", () => {
    expect(
      workOrderTransitionSchema.safeParse({
        action: "complete",
        occurredAt: "2026-07-18T04:10:00Z",
        completionSummary: "完成",
        customerSignoffName: null,
        overrideReason: null,
        status: "completed",
      }).success,
    ).toBe(false);
  });

  it("requires a reason for cancellation", () => {
    expect(
      workOrderTransitionSchema.safeParse({
        action: "cancel",
        occurredAt: "2026-07-18T04:10:00Z",
        reason: "  ",
      }).success,
    ).toBe(false);
  });

  it("accepts a documented timestamp override on a simple field action", () => {
    expect(
      workOrderTransitionSchema.safeParse({
        action: "arrive",
        occurredAt: "2026-07-17T02:10:00Z",
        overrideReason: "主管核准離線補登",
      }).success,
    ).toBe(true);
  });
});
