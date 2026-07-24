import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import { verifyLineSignature } from "./signature";

const secret = "0123456789abcdef0123456789abcdef";
const rawBody = new TextEncoder().encode(
  JSON.stringify({ destination: "Ubotuser", events: [] }),
);

function sign(body: Uint8Array, withSecret: string): string {
  return createHmac("sha256", withSecret).update(Buffer.from(body)).digest("base64");
}

describe("verifyLineSignature", () => {
  it("accepts a signature computed with the matching secret", () => {
    expect(verifyLineSignature(rawBody, sign(rawBody, secret), secret)).toBe(true);
  });

  it("rejects a signature computed with a different secret", () => {
    expect(verifyLineSignature(rawBody, sign(rawBody, "wrong-secret-value"), secret)).toBe(false);
  });

  it("rejects a one-byte-flipped body (tamper)", () => {
    const good = sign(rawBody, secret);
    const tampered = new Uint8Array(rawBody);
    tampered[0] = tampered[0] ^ 0x01;
    expect(verifyLineSignature(tampered, good, secret)).toBe(false);
  });

  it("rejects a truncated / wrong-length signature without throwing", () => {
    expect(verifyLineSignature(rawBody, "abc", secret)).toBe(false);
  });

  it("rejects a missing header", () => {
    expect(verifyLineSignature(rawBody, undefined, secret)).toBe(false);
    expect(verifyLineSignature(rawBody, "", secret)).toBe(false);
  });

  it("rejects a non-base64 signature without throwing", () => {
    expect(verifyLineSignature(rawBody, "!!!not-base64!!!", secret)).toBe(false);
  });

  it("rejects when the secret is empty (fail closed)", () => {
    expect(verifyLineSignature(rawBody, sign(rawBody, secret), "")).toBe(false);
  });

  it("is stable across an empty body", () => {
    const empty = new Uint8Array(0);
    expect(verifyLineSignature(empty, sign(empty, secret), secret)).toBe(true);
  });
});
