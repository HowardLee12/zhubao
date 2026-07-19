import { createHash, createHmac, randomBytes } from "node:crypto";

export interface PublicIntakeToken {
  rawToken: string;
  hashHex: string;
}

export function createPublicCapabilityToken(): PublicIntakeToken {
  const rawToken = randomBytes(32).toString("base64url");
  const hashHex = createHash("sha256")
    .update(rawToken, "utf8")
    .digest("hex");

  return { rawToken, hashHex };
}

interface IdempotentCapabilityContext {
  operation: "quote-send" | "quote-rotate";
  organizationId: string;
  resourceId: string;
  idempotencyKey: string;
}

/**
 * Derive a stable 256-bit capability for a staff mutation replay.
 *
 * The public token remains computationally unguessable because it is an HMAC
 * under a server-only key. Domain separation prevents the IP-hash use of the
 * same deployment secret from sharing an input namespace with capabilities.
 */
export function createIdempotentPublicCapabilityToken(
  context: IdempotentCapabilityContext,
): PublicIntakeToken {
  const secret = process.env.PUBLIC_TOKEN_PEPPER ?? "";
  if (Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error("PUBLIC_TOKEN_PEPPER must contain at least 32 bytes");
  }

  const canonicalContext = JSON.stringify({
    domain: "renoly-public-capability-v1",
    operation: context.operation,
    organizationId: context.organizationId,
    resourceId: context.resourceId,
    idempotencyKey: context.idempotencyKey,
  });
  const rawToken = createHmac("sha256", secret)
    .update(canonicalContext, "utf8")
    .digest("base64url");
  const hashHex = createHash("sha256").update(rawToken, "utf8").digest("hex");

  return { rawToken, hashHex };
}

// Backwards-compatible name for the intake surface. Quote links use the same
// 256-bit random capability format but remain independently scoped in Postgres.
export const createPublicIntakeToken = createPublicCapabilityToken;
