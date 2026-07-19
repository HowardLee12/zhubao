import { describe, expect, it } from "vitest";

import { toActionResult } from "./service-request-result";

describe("toActionResult", () => {
  it("maps a service_requests rowtype to a compact camelCase action result", () => {
    const result = toActionResult({
      id: "80000000-0000-4000-8000-000000000001",
      status: "triaged",
      priority: "high",
      category: "waterproofing",
      customer_id: "40000000-0000-4000-8000-000000000001",
      location_id: null,
      asset_id: null,
      assigned_member_id: "30000000-0000-4000-8000-000000000002",
      triaged_at: "2026-07-17T00:00:00.000Z",
      converted_at: null,
      converted_project_id: null,
      converted_work_order_id: null,
      lock_version: 2,
      updated_at: "2026-07-17T00:00:00.000Z",
    });

    expect(result).toEqual({
      id: "80000000-0000-4000-8000-000000000001",
      status: "triaged",
      priority: "high",
      category: "waterproofing",
      customerId: "40000000-0000-4000-8000-000000000001",
      locationId: null,
      assetId: null,
      assignedMemberId: "30000000-0000-4000-8000-000000000002",
      triagedAt: "2026-07-17T00:00:00.000Z",
      convertedAt: null,
      convertedProjectId: null,
      convertedWorkOrderId: null,
      lockVersion: 2,
      updatedAt: "2026-07-17T00:00:00.000Z",
    });
  });

  it("returns null when the RPC payload is not an object", () => {
    expect(toActionResult(null)).toBeNull();
    expect(toActionResult("nope")).toBeNull();
  });

  it("returns null when a required field is malformed", () => {
    expect(toActionResult({ id: "not-a-uuid", status: "triaged", lock_version: 1 })).toBeNull();
  });
});
