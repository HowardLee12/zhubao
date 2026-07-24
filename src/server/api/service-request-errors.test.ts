import { describe, expect, it } from "vitest";

import { mapServiceRequestRpcError } from "./service-request-errors";

function mapped(message: string) {
  return mapServiceRequestRpcError({ message });
}

describe("mapServiceRequestRpcError", () => {
  it("maps AUTH_REQUIRED to 401", () => {
    expect(mapped("AUTH_REQUIRED").status).toBe(401);
  });

  it("maps FORBIDDEN to 403", () => {
    const problem = mapped("FORBIDDEN");
    expect(problem.status).toBe(403);
    expect(problem.code).toBe("FORBIDDEN");
  });

  it("maps STALE_VERSION to 412 version conflict", () => {
    const problem = mapped("STALE_VERSION");
    expect(problem.status).toBe(412);
    expect(problem.code).toBe("VERSION_CONFLICT");
  });

  it("maps SERVICE_REQUEST_NOT_FOUND to a non-leaky 404", () => {
    const problem = mapped("SERVICE_REQUEST_NOT_FOUND");
    expect(problem.status).toBe(404);
  });

  it.each([
    "INVALID_SERVICE_REQUEST_TRANSITION",
    "TRIAGE_REQUIRES_CUSTOMER",
    "CONVERSION_TARGET_REQUIRED",
    "INVALID_CONVERSION_MODE",
    "CLOSE_REASON_REQUIRED",
    "QUOTED_REQUIRES_SENT_QUOTE",
    "INVALID_PRIORITY",
    "INVALID_CATEGORY",
  ])("maps %s to 409", (message) => {
    expect(mapped(message).status).toBe(409);
  });

  it.each([
    "CUSTOMER_NOT_IN_ORG",
    "LOCATION_CUSTOMER_MISMATCH",
    "ASSET_SCOPE_MISMATCH",
    "MEMBER_NOT_ACTIVE",
    "MEMBER_NOT_ASSIGNABLE",
  ])("maps %s to 422", (message) => {
    expect(mapped(message).status).toBe(422);
  });

  it("maps INVALID_LIMIT to 400", () => {
    expect(mapped("INVALID_LIMIT").status).toBe(400);
  });

  it("maps PILOT_VALIDATION_FAILED to 400", () => {
    expect(mapped("PILOT_VALIDATION_FAILED").status).toBe(400);
  });

  it("maps a unique_violation convert race to 409", () => {
    expect(mapServiceRequestRpcError({ code: "23505", message: "duplicate key" }).status).toBe(
      409,
    );
  });

  it("falls back to a 500 for an unrecognized message", () => {
    expect(mapped("SOMETHING_ELSE").status).toBe(500);
  });
});
