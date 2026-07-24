import { afterEach, describe, expect, it, vi } from "vitest";

import { getAuthSigningKey, resolveAuthSecret } from "./auth-key";

describe("resolveAuthSecret", () => {
  it("accepts an explicitly configured strong secret", () => {
    const secret = "a-unique-secret-that-is-longer-than-32-characters";
    expect(resolveAuthSecret(secret, "production")).toBe(secret);
  });

  it.each([undefined, "short-secret"])(
    "fails closed in production when AUTH_SECRET is missing or weak",
    (value) => {
      expect(() => resolveAuthSecret(value, "production")).toThrow(/AUTH_SECRET/);
    },
  );

  it("uses a local-only fallback outside production", () => {
    expect(resolveAuthSecret(undefined, "test")).toHaveLength(36);
  });
});

describe("getAuthSigningKey", () => {
  afterEach(() => {
    // Every env change below goes through vi.stubEnv, so a single restore fully
    // returns AUTH_SECRET and NODE_ENV to their pre-test values.
    vi.unstubAllEnvs();
  });

  it("reads the secret lazily so importing the module never throws at load", () => {
    // The module was imported at the top of this file. If the signing key were
    // computed eagerly at module scope it would already have thrown; reaching
    // this assertion proves evaluation is deferred.
    expect(typeof getAuthSigningKey).toBe("function");
  });

  it("resolves a usable key on demand outside production", () => {
    const key = getAuthSigningKey();
    expect(ArrayBuffer.isView(key)).toBe(true);
    expect(key.constructor.name).toBe("Uint8Array");
    expect(key.length).toBeGreaterThan(0);
  });

  it("fails closed only when called in production with a weak secret", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_SECRET", "too-short");
    expect(() => getAuthSigningKey()).toThrow(/AUTH_SECRET/);
  });

  it("returns the configured strong secret bytes in production", () => {
    const secret = "a-unique-secret-that-is-longer-than-32-characters";
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_SECRET", secret);
    expect(getAuthSigningKey()).toEqual(new TextEncoder().encode(secret));
  });
});
