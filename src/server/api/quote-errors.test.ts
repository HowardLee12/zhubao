import { describe, expect, it } from "vitest";

import { mapQuoteRpcError, mapPublicQuoteRpcError } from "./quote-errors";

describe("quote RPC errors", () => {
  it("maps optimistic concurrency to a precondition failure", () => {
    expect(mapQuoteRpcError({ message: "STALE_VERSION" })).toMatchObject({
      status: 412,
      code: "VERSION_CONFLICT",
    });
  });

  it("does not leak cross-tenant quote existence", () => {
    expect(mapQuoteRpcError({ message: "QUOTE_NOT_FOUND" })).toMatchObject({
      status: 404,
      code: "NOT_FOUND",
    });
  });

  it.each([
    ["AUTH_REQUIRED", 401, "AUTHENTICATION_REQUIRED"],
    ["FORBIDDEN", 403, "FORBIDDEN"],
    ["QUOTE_SEND_ROLE_REQUIRED", 403, "FORBIDDEN"],
    ["QUOTE_VERSION_NOT_FOUND", 404, "NOT_FOUND"],
    ["PILOT_IDEMPOTENCY_CONFLICT", 409, "IDEMPOTENCY_CONFLICT"],
    ["PILOT_IDEMPOTENCY_IN_PROGRESS", 409, "IDEMPOTENCY_IN_PROGRESS"],
    ["PILOT_VALIDATION_FAILED", 422, "VALIDATION_FAILED"],
    ["QUOTE_BINDING_MISMATCH", 422, "VALIDATION_FAILED"],
  ])("maps staff signal %s to %s/%s", (message, status, code) => {
    expect(mapQuoteRpcError({ details: message })).toMatchObject({ status, code });
  });

  it.each([
    "ACTIVE_VERSION_CHANGED",
    "QUOTE_VERSION_IMMUTABLE",
    "QUOTE_ALREADY_RESOLVED",
    "QUOTE_REVISION_NOT_ALLOWED",
    "QUOTE_REQUEST_NOT_READY",
    "QUOTE_ITEMS_REQUIRED",
    "QUOTE_ALREADY_EXPIRED",
    "QUOTE_ALREADY_EXISTS",
    "QUOTE_ACCEPTANCE_REQUIRED",
  ])("maps %s to a conflict", (message) => {
    expect(mapQuoteRpcError({ message })).toMatchObject({ status: 409 });
  });

  it("maps a database uniqueness conflict without leaking its details", () => {
    expect(mapQuoteRpcError({ code: "23505", message: "secret constraint" })).toMatchObject({
      status: 409,
      code: "INVALID_QUOTE_STATE",
    });
  });

  it("sanitizes unknown staff database errors", () => {
    const problem = mapQuoteRpcError({ message: "secret SQL detail" });
    expect(problem).toMatchObject({ status: 500, code: "INTERNAL_ERROR" });
    expect(problem.detail).not.toContain("secret SQL detail");
  });

  it("collapses invalid, expired, and revoked public links to the same 404", () => {
    expect(mapPublicQuoteRpcError({ message: "PUBLIC_QUOTE_LINK_INVALID" })).toMatchObject({
      status: 404,
      code: "PUBLIC_LINK_NOT_FOUND",
    });
  });

  it("keeps a resolved public decision distinct from a missing link", () => {
    expect(mapPublicQuoteRpcError({ message: "QUOTE_ALREADY_RESOLVED" })).toMatchObject({
      status: 409,
      code: "QUOTE_ALREADY_RESOLVED",
    });
  });

  it.each([
    ["PILOT_IDEMPOTENCY_CONFLICT", "IDEMPOTENCY_CONFLICT"],
    ["PILOT_IDEMPOTENCY_IN_PROGRESS", "IDEMPOTENCY_IN_PROGRESS"],
    ["ACTIVE_VERSION_CHANGED", "ACTIVE_VERSION_CHANGED"],
    ["QUOTE_EXPIRED", "QUOTE_NOT_RESPONDABLE"],
    ["QUOTE_NOT_RESPONDABLE", "QUOTE_NOT_RESPONDABLE"],
    ["PILOT_VALIDATION_FAILED", "VALIDATION_FAILED"],
  ])("maps public signal %s to %s", (message, code) => {
    expect(mapPublicQuoteRpcError({ hint: message })).toMatchObject({ code });
  });

  it("sanitizes unknown public gateway errors", () => {
    const problem = mapPublicQuoteRpcError({ message: "secret gateway failure" });
    expect(problem).toMatchObject({ status: 500, code: "INTERNAL_ERROR" });
    expect(problem.detail).not.toContain("secret gateway failure");
  });
});
