import { describe, expect, it } from "vitest";

import { mapWorkOrderRpcError, WorkOrderScheduleConflict } from "./work-order-errors";

describe("mapWorkOrderRpcError", () => {
  it("maps auth and forbidden signals", () => {
    expect(mapWorkOrderRpcError({ message: "AUTH_REQUIRED" }).status).toBe(401);
    expect(mapWorkOrderRpcError({ message: "FORBIDDEN" }).status).toBe(403);
    expect(mapWorkOrderRpcError({ message: "FORCE_COMPLETE_REQUIRES_OWNER" }).status).toBe(403);
    expect(mapWorkOrderRpcError({ message: "PHOTO_VERIFICATION_MISMATCH" }).status).toBe(403);
  });

  it("maps not-found signals to a non-leaky 404", () => {
    for (const message of [
      "WORK_ORDER_NOT_FOUND",
      "ASSIGNMENT_NOT_FOUND",
      "CHECKLIST_NOT_FOUND",
      "CHECKLIST_ITEM_NOT_FOUND",
      "PHOTO_NOT_FOUND",
    ]) {
      const problem = mapWorkOrderRpcError({ message });
      expect(problem.status).toBe(404);
      expect(problem.code).toBe("NOT_FOUND");
    }
  });

  it("maps stale version to 412", () => {
    const problem = mapWorkOrderRpcError({ message: "STALE_VERSION" });
    expect(problem.status).toBe(412);
    expect(problem.code).toBe("VERSION_CONFLICT");
  });

  it("maps required/invalid business signals to 422", () => {
    for (const message of [
      "WORK_ORDER_PAYLOAD_INVALID",
      "SCHEDULE_PAYLOAD_INVALID",
      "ASSIGNMENT_PAYLOAD_INVALID",
      "CHECKLIST_PAYLOAD_INVALID",
      "CHECKLIST_ITEM_INVALID",
      "PHOTO_VERIFICATION_INVALID",
      "PHOTO_UPDATE_INVALID",
      "OCCURRED_AT_REQUIRED",
      "OCCURRED_AT_OUT_OF_RANGE",
      "FORCE_COMPLETE_REASON_REQUIRED",
      "COMPLETION_SUMMARY_REQUIRED",
      "REQUIRED_CHECKLIST_INCOMPLETE",
      "REQUIRED_EVIDENCE_MISSING",
      "BEFORE_AFTER_PHOTOS_REQUIRED",
      "ASSIGNMENT_CANCEL_REASON_REQUIRED",
      "DECLINE_REASON_REQUIRED",
      "SCHEDULE_CONFLICT_QUERY_INVALID",
      "LIST_PAGE_SIZE_INVALID",
      "WORK_ORDER_BINDING_MISMATCH",
    ]) {
      expect(mapWorkOrderRpcError({ message }).status).toBe(422);
    }
  });

  it("maps state/limit conflicts to 409", () => {
    for (const message of [
      "WORK_ORDER_NOT_SCHEDULABLE",
      "WORK_ORDER_NOT_ASSIGNABLE",
      "WORK_ORDER_NOT_EDITABLE",
      "WORK_ORDER_NOT_EDITABLE_ON_SITE",
      "INVALID_WORK_ORDER_TRANSITION",
      "INVALID_ASSIGNMENT_TRANSITION",
      "ASSIGNMENT_NOT_EDITABLE",
      "ASSIGNMENT_LIMIT_EXCEEDED",
      "CHECKLIST_ALREADY_COMPLETED",
      "PHOTO_ALREADY_READY",
      "PHOTO_NOT_PENDING",
      "PHOTO_DELETED",
      "PHOTO_IS_COMPLETION_EVIDENCE",
      "IDEMPOTENCY_CONFLICT",
      "IDEMPOTENCY_IN_PROGRESS",
      "SCHEDULE_DUPLICATE_MEMBER",
    ]) {
      expect(mapWorkOrderRpcError({ message }).status).toBe(409);
    }
  });

  it("maps SCHEDULE_CONFLICT to a 409 with parsed conflicts from PG_EXCEPTION_DETAIL", () => {
    const conflicts = [
      {
        membershipId: "30000000-0000-4000-8000-000000000003",
        workOrderId: "82060000-0000-4000-8000-000000000001",
        workOrderNo: "W-2026-0002",
        startsAt: "2026-08-01T01:00:00+00:00",
        endsAt: "2026-08-01T03:00:00+00:00",
      },
    ];
    const problem = mapWorkOrderRpcError({
      message: "SCHEDULE_CONFLICT",
      details: JSON.stringify(conflicts),
    });
    expect(problem.status).toBe(409);
    expect(problem.code).toBe("SCHEDULE_CONFLICT");
    expect(problem).toBeInstanceOf(WorkOrderScheduleConflict);
    expect((problem as WorkOrderScheduleConflict).conflicts).toEqual(conflicts);
  });

  it("keeps SCHEDULE_CONFLICT a 409 even when the detail is not valid JSON", () => {
    const problem = mapWorkOrderRpcError({ message: "SCHEDULE_CONFLICT", details: "not-json" });
    expect(problem.status).toBe(409);
    expect((problem as WorkOrderScheduleConflict).conflicts).toEqual([]);
  });

  it("falls back to a sanitized 500 for unknown signals", () => {
    const problem = mapWorkOrderRpcError({ message: "some raw connection secret" });
    expect(problem.status).toBe(500);
    expect(problem.detail).not.toContain("secret");
  });
});
