import { describe, expect, it } from "vitest";

import { mapMembershipRpcError } from "./membership-errors";

describe("mapMembershipRpcError", () => {
  it.each([
    ["AUTH_REQUIRED", 401],
    ["FORBIDDEN", 403],
    ["MEMBERSHIP_ALREADY_EXISTS", 409],
    ["PILOT_INVALID_ROLE", 422],
    ["PILOT_VALIDATION_FAILED", 422],
    ["PILOT_IDEMPOTENCY_CONFLICT", 409],
    ["PILOT_IDEMPOTENCY_IN_PROGRESS", 409],
  ])("maps %s to HTTP %i", (message, status) => {
    expect(mapMembershipRpcError({ message }).status).toBe(status);
  });

  it("falls back to a 500 for an unrecognized error", () => {
    expect(mapMembershipRpcError({ message: "SOMETHING_ELSE" }).status).toBe(500);
  });

  it("never echoes the raw RPC message into the problem detail", () => {
    const problem = mapMembershipRpcError({ message: "MEMBERSHIP_ALREADY_EXISTS at users(id=secret)" });
    expect(problem.detail).not.toMatch(/secret/);
  });
});
