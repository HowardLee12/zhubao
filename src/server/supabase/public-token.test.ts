import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { createPublicIntakeToken } from "./public-token";

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
