import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// AES-256-GCM envelope for LINE channel secrets and access tokens. The plaintext
// NEVER leaves the server: the connect route encrypts here and stores the ciphertext
// + nonce (+ key_version) in private.line_channel_credentials; the webhook route and
// the sender decrypt just-in-time. The client only ever learns credentialConfigured.
//
// Key ring: the master key is read from LINE_CREDENTIAL_MASTER_KEY_V<N> (base64 of a
// 32-byte key), selected by key_version, so a key can be rotated (write V2, keep V1
// to decrypt legacy rows) without re-encrypting in place. Missing/short keys FAIL
// CLOSED (throw) rather than silently degrading to a weak or absent key.
//
// AAD binds each ciphertext to org + channel + credential-type + key_version, so a
// row cannot be replayed across tenants, channels or credential slots — a mismatch
// fails the GCM tag check on decrypt.

export type CredentialType = "secret" | "access_token";

export interface CredentialContext {
  organizationId: string;
  lineChannelId: string;
  credentialType: CredentialType;
}

export interface EncryptedCredential {
  ciphertext: Buffer;
  nonce: Buffer;
  keyVersion: number;
}

const NONCE_BYTES = 12;
const KEY_BYTES = 32;

export function buildCredentialAad(context: CredentialContext, keyVersion: number): string {
  return [
    context.organizationId,
    context.lineChannelId,
    context.credentialType,
    String(keyVersion),
  ].join("|");
}

function resolveMasterKey(keyVersion: number): Buffer {
  if (!Number.isInteger(keyVersion) || keyVersion <= 0) {
    throw new Error("Invalid credential key version.");
  }
  const raw = process.env[`LINE_CREDENTIAL_MASTER_KEY_V${keyVersion}`]?.trim();
  if (!raw) {
    throw new Error(`LINE_CREDENTIAL_MASTER_KEY_V${keyVersion} is not configured.`);
  }
  // Buffer.from(..., "base64") is lenient and never throws; an invalid key surfaces
  // as a wrong decoded length, which the guard below rejects (fail closed).
  const key = Buffer.from(raw, "base64");
  if (key.length !== KEY_BYTES) {
    throw new Error(`LINE_CREDENTIAL_MASTER_KEY_V${keyVersion} must decode to 32 bytes.`);
  }
  return key;
}

export function encryptCredential(
  plaintext: string,
  context: CredentialContext,
  keyVersion: number,
): EncryptedCredential {
  const key = resolveMasterKey(keyVersion);
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from(buildCredentialAad(context, keyVersion), "utf8"));
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Store body || tag so the ciphertext column is self-describing on decrypt.
  return { ciphertext: Buffer.concat([body, tag]), nonce, keyVersion };
}

export function decryptCredential(
  ciphertext: Uint8Array,
  nonce: Uint8Array,
  context: CredentialContext,
  keyVersion: number,
): string {
  const key = resolveMasterKey(keyVersion);
  const buffer = Buffer.from(ciphertext);
  if (buffer.length <= 16) {
    throw new Error("Ciphertext is too short to contain a GCM tag.");
  }
  const body = buffer.subarray(0, buffer.length - 16);
  const tag = buffer.subarray(buffer.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(nonce));
  decipher.setAAD(Buffer.from(buildCredentialAad(context, keyVersion), "utf8"));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
}
