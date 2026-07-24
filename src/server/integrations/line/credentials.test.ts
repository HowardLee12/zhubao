import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  buildCredentialAad,
  decryptCredential,
  encryptCredential,
  type CredentialContext,
} from "./credentials";

// Two 32-byte (base64) master keys for a V1 -> V2 key ring rotation test.
const KEY_V1 = Buffer.alloc(32, 1).toString("base64");
const KEY_V2 = Buffer.alloc(32, 2).toString("base64");

const context: CredentialContext = {
  organizationId: "a1000000-0000-4000-8000-000000000001",
  lineChannelId: "a1c00000-0000-4000-8000-000000000001",
  credentialType: "secret",
};

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {
    v1: process.env.LINE_CREDENTIAL_MASTER_KEY_V1,
    v2: process.env.LINE_CREDENTIAL_MASTER_KEY_V2,
  };
  process.env.LINE_CREDENTIAL_MASTER_KEY_V1 = KEY_V1;
  process.env.LINE_CREDENTIAL_MASTER_KEY_V2 = KEY_V2;
});

afterEach(() => {
  if (saved.v1 === undefined) delete process.env.LINE_CREDENTIAL_MASTER_KEY_V1;
  else process.env.LINE_CREDENTIAL_MASTER_KEY_V1 = saved.v1;
  if (saved.v2 === undefined) delete process.env.LINE_CREDENTIAL_MASTER_KEY_V2;
  else process.env.LINE_CREDENTIAL_MASTER_KEY_V2 = saved.v2;
});

describe("encryptCredential / decryptCredential", () => {
  it("round-trips a plaintext under V1", () => {
    const enc = encryptCredential("channel-secret-value", context, 1);
    expect(enc.keyVersion).toBe(1);
    expect(enc.nonce).toHaveLength(12);
    // ciphertext includes the 16-byte GCM tag, so it is strictly > 16 bytes.
    expect(enc.ciphertext.length).toBeGreaterThan(16);
    const dec = decryptCredential(enc.ciphertext, enc.nonce, context, 1);
    expect(dec).toBe("channel-secret-value");
  });

  it("produces a fresh nonce per call (no nonce reuse)", () => {
    const a = encryptCredential("x", context, 1);
    const b = encryptCredential("x", context, 1);
    expect(Buffer.from(a.nonce).equals(Buffer.from(b.nonce))).toBe(false);
    expect(Buffer.from(a.ciphertext).equals(Buffer.from(b.ciphertext))).toBe(false);
  });

  it("round-trips under V2 (key ring rotation)", () => {
    const enc = encryptCredential("token-value", context, 2);
    expect(enc.keyVersion).toBe(2);
    expect(decryptCredential(enc.ciphertext, enc.nonce, context, 2)).toBe("token-value");
  });

  it("fails closed when decrypting with the wrong key version", () => {
    const enc = encryptCredential("secret", context, 1);
    expect(() => decryptCredential(enc.ciphertext, enc.nonce, context, 2)).toThrow();
  });

  it("fails closed on a tampered ciphertext (auth tag mismatch)", () => {
    const enc = encryptCredential("secret", context, 1);
    const tampered = Buffer.from(enc.ciphertext);
    tampered[0] = tampered[0] ^ 0xff;
    expect(() => decryptCredential(tampered, enc.nonce, context, 1)).toThrow();
  });

  it("fails closed when the AAD context does not match (bound to org+channel+type)", () => {
    const enc = encryptCredential("secret", context, 1);
    const otherType: CredentialContext = { ...context, credentialType: "access_token" };
    expect(() => decryptCredential(enc.ciphertext, enc.nonce, otherType, 1)).toThrow();
  });

  it("fails closed when the master key for the version is not configured", () => {
    delete process.env.LINE_CREDENTIAL_MASTER_KEY_V2;
    expect(() => encryptCredential("secret", context, 2)).toThrow();
  });

  it("fails closed on a non-positive key version", () => {
    expect(() => encryptCredential("secret", context, 0)).toThrow(/key version/i);
    expect(() => encryptCredential("secret", context, -1)).toThrow(/key version/i);
  });

  it("fails closed when the configured key does not decode to 32 bytes", () => {
    process.env.LINE_CREDENTIAL_MASTER_KEY_V1 = Buffer.alloc(16, 9).toString("base64");
    expect(() => encryptCredential("secret", context, 1)).toThrow(/32 bytes/i);
  });

  it("fails closed decrypting a ciphertext that is too short to hold a GCM tag", () => {
    expect(() => decryptCredential(new Uint8Array(8), new Uint8Array(12), context, 1)).toThrow(
      /too short/i,
    );
  });

  it("binds AAD to org, channel, type and key_version", () => {
    const aad = buildCredentialAad(context, 1);
    expect(aad).toBe(
      "a1000000-0000-4000-8000-000000000001|a1c00000-0000-4000-8000-000000000001|secret|1",
    );
  });
});
