import { describe, expect, it } from "vitest";

import { mapOperationsRpcError, rateLimitedProblem } from "./operations-errors";

describe("mapOperationsRpcError", () => {
  it("maps sensitive-field rejection to a 422", () => {
    expect(mapOperationsRpcError({ code: "RENSF" })).toMatchObject({ status: 422 });
    expect(
      mapOperationsRpcError({ message: "PAYMENT_SENSITIVE_FIELD_REJECTED" }),
    ).toMatchObject({ status: 422, code: "SENSITIVE_FIELD_REJECTED" });
  });

  it("maps role/owner/reauth failures to a 403", () => {
    expect(mapOperationsRpcError({ message: "PAYMENT_ROLE_REQUIRED" }).status).toBe(403);
    expect(mapOperationsRpcError({ message: "DATA_DELETION_OWNER_REQUIRED" }).status).toBe(403);
    expect(mapOperationsRpcError({ message: "DATA_DELETION_REAUTH_INVALID" }).status).toBe(403);
  });

  it("maps STALE_VERSION to a 412", () => {
    expect(mapOperationsRpcError({ message: "STALE_VERSION" }).status).toBe(412);
  });

  it("maps the open-request conflict (RENOP) to a 409 naming the choice", () => {
    expect(mapOperationsRpcError({ code: "RENOP" })).toMatchObject({
      status: 409,
      code: "OPEN_REQUEST_CONFLICT",
    });
  });

  it("maps missing rows and cross-tenant to a non-leaky 404", () => {
    expect(mapOperationsRpcError({ message: "PAYMENT_MILESTONE_NOT_FOUND" }).status).toBe(404);
    expect(mapOperationsRpcError({ message: "ASSET_NOT_FOUND" }).status).toBe(404);
  });

  it("maps payload/amount/range problems to a 422", () => {
    expect(mapOperationsRpcError({ message: "PAYMENT_AMOUNT_INVALID" }).status).toBe(422);
    expect(mapOperationsRpcError({ message: "DASHBOARD_RANGE_TOO_LARGE" }).status).toBe(422);
  });

  it("maps state conflicts to a 409", () => {
    expect(mapOperationsRpcError({ message: "PAYMENT_MILESTONE_NOT_PAYABLE" }).status).toBe(409);
    expect(mapOperationsRpcError({ message: "MAINTENANCE_PLAN_TRANSITION_INVALID" }).status).toBe(
      409,
    );
    expect(mapOperationsRpcError({ message: "ASSET_RETIRED" }).status).toBe(409);
  });

  it("falls back to a 500 for unknown errors", () => {
    expect(mapOperationsRpcError({ message: "SOMETHING_ELSE" }).status).toBe(500);
  });

  it("exposes a 429 rate-limited problem", () => {
    expect(rateLimitedProblem()).toMatchObject({ status: 429, code: "RATE_LIMITED" });
  });
});
