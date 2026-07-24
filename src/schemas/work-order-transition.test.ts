import { describe, expect, it } from "vitest";

import {
  TRANSITION_TARGET_STATUS,
  workOrderRouteTransitionSchema,
} from "./work-order-transition";

describe("workOrderRouteTransitionSchema", () => {
  it("accepts a simple action with occurredAt", () => {
    expect(
      workOrderRouteTransitionSchema.safeParse({
        action: "arrive",
        occurredAt: "2026-08-01T02:00:00+00:00",
      }).success,
    ).toBe(true);
  });

  it("rejects schedule (handled by its own route)", () => {
    expect(
      workOrderRouteTransitionSchema.safeParse({
        action: "schedule",
        occurredAt: "2026-08-01T02:00:00+00:00",
      }).success,
    ).toBe(false);
  });

  it("requires a completionSummary to complete", () => {
    expect(
      workOrderRouteTransitionSchema.safeParse({
        action: "complete",
        occurredAt: "2026-08-01T05:00:00+00:00",
      }).success,
    ).toBe(false);
    expect(
      workOrderRouteTransitionSchema.safeParse({
        action: "complete",
        occurredAt: "2026-08-01T05:00:00+00:00",
        completionSummary: "已完工",
      }).success,
    ).toBe(true);
  });

  it("requires a reason to cancel and reopen", () => {
    expect(
      workOrderRouteTransitionSchema.safeParse({
        action: "cancel",
        occurredAt: "2026-08-01T05:00:00+00:00",
      }).success,
    ).toBe(false);
  });

  it("maps every action to the DB target status", () => {
    expect(TRANSITION_TARGET_STATUS.arrive).toBe("on_site");
    expect(TRANSITION_TARGET_STATUS.reopen).toBe("on_site");
    expect(TRANSITION_TARGET_STATUS.complete).toBe("completed");
  });
});
