import { describe, expect, it } from "vitest";

import { mapIntakeDraftRpcError } from "./intake-draft-errors";

// The confirm/dismiss RPCs raise a message string carrying a stable token; this mapper
// is the single place the routes turn that token into an RFC-9457 status. Cross-tenant
// and not-found both collapse to a non-leaky 404, the has_org_role gate surfaces as
// 403, the optimistic-lock miss as 412, and an illegal state at the current draft
// status as 409. Anything unrecognised must fall through to a 500 (never leak).

describe("mapIntakeDraftRpcError", () => {
  it("maps AUTH_REQUIRED to 401", () => {
    const problem = mapIntakeDraftRpcError({ message: "AUTH_REQUIRED" });
    expect(problem.status).toBe(401);
  });

  it("maps FORBIDDEN (has_org_role gate) to 403", () => {
    const problem = mapIntakeDraftRpcError({ message: "FORBIDDEN: role" });
    expect(problem.status).toBe(403);
    expect(problem.code).toBe("FORBIDDEN");
  });

  it("maps STALE_VERSION (optimistic-lock miss) to 412", () => {
    const problem = mapIntakeDraftRpcError({ message: "STALE_VERSION" });
    expect(problem.status).toBe(412);
    expect(problem.code).toBe("VERSION_CONFLICT");
  });

  it("maps INTAKE_DRAFT_NOT_FOUND to a non-leaky 404", () => {
    const problem = mapIntakeDraftRpcError({ message: "INTAKE_DRAFT_NOT_FOUND" });
    expect(problem.status).toBe(404);
    expect(problem.code).toBe("NOT_FOUND");
  });

  it("maps CONVERSATION_NOT_FOUND to 404 as well", () => {
    const problem = mapIntakeDraftRpcError({ message: "CONVERSATION_NOT_FOUND" });
    expect(problem.status).toBe(404);
  });

  it("maps INTAKE_DRAFT_NOT_CONFIRMABLE to a 409 invalid-state", () => {
    const problem = mapIntakeDraftRpcError({ message: "INTAKE_DRAFT_NOT_CONFIRMABLE" });
    expect(problem.status).toBe(409);
    expect(problem.code).toBe("INVALID_STATE_TRANSITION");
  });

  it("maps INTAKE_DRAFT_NOT_DISMISSABLE to a 409 invalid-state", () => {
    const problem = mapIntakeDraftRpcError({ message: "INTAKE_DRAFT_NOT_DISMISSABLE" });
    expect(problem.status).toBe(409);
  });

  it("reads the token from details when message is absent", () => {
    const problem = mapIntakeDraftRpcError({ details: "FORBIDDEN" });
    expect(problem.status).toBe(403);
  });

  it("falls through to a non-leaky 500 for an unrecognised error", () => {
    const problem = mapIntakeDraftRpcError({ code: "XX000", message: "some unexpected pg error" });
    expect(problem.status).toBe(500);
  });

  it("falls through to 500 when the error is empty (no message, no details)", () => {
    const problem = mapIntakeDraftRpcError({});
    expect(problem.status).toBe(500);
  });
});
