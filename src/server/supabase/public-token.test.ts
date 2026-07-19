import { createHash } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createIdempotentPublicCapabilityToken,
  createPublicIntakeToken,
} from "./public-token";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("createPublicIntakeToken", () => {
  it("returns 32 random bytes as base64url and a lowercase SHA-256 hex digest", () => {
    const result = createPublicIntakeToken();

    expect(result.rawToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(result.hashHex).toMatch(/^[a-f0-9]{64}$/);
    expect(result.hashHex).toBe(
      createHash("sha256").update(result.rawToken, "utf8").digest("hex"),
    );
    expect(result.hashHex).not.toContain(result.rawToken);
  });

  it("does not reuse a token", () => {
    expect(createPublicIntakeToken().rawToken).not.toBe(
      createPublicIntakeToken().rawToken,
    );
  });
});

describe("createIdempotentPublicCapabilityToken", () => {
  const context = {
    operation: "quote-send" as const,
    organizationId: "20000000-0000-4000-8000-000000000001",
    resourceId: "92000000-0000-4000-8000-000000000001",
    idempotencyKey: "send-idempotency-key",
  };

  it("derives the same unguessable 256-bit capability for the same mutation replay", () => {
    vi.stubEnv("PUBLIC_TOKEN_PEPPER", "test-public-token-pepper-with-at-least-32-bytes");

    const first = createIdempotentPublicCapabilityToken(context);
    const replay = createIdempotentPublicCapabilityToken(context);

    expect(replay).toEqual(first);
    expect(first.rawToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first.hashHex).toBe(
      createHash("sha256").update(first.rawToken, "utf8").digest("hex"),
    );
  });

  it("domain-separates operations and idempotency keys", () => {
    vi.stubEnv("PUBLIC_TOKEN_PEPPER", "test-public-token-pepper-with-at-least-32-bytes");

    expect(
      createIdempotentPublicCapabilityToken({ ...context, operation: "quote-rotate" }).rawToken,
    ).not.toBe(createIdempotentPublicCapabilityToken(context).rawToken);
    expect(
      createIdempotentPublicCapabilityToken({ ...context, idempotencyKey: "another-key" }).rawToken,
    ).not.toBe(createIdempotentPublicCapabilityToken(context).rawToken);
  });

  it("fails closed when the server derivation secret is missing or too short", () => {
    vi.stubEnv("PUBLIC_TOKEN_PEPPER", "short");
    expect(() => createIdempotentPublicCapabilityToken(context)).toThrow(
      "PUBLIC_TOKEN_PEPPER",
    );
  });
});
