const MINIMUM_AUTH_SECRET_LENGTH = 32;
const DEVELOPMENT_ONLY_SECRET = "renoly-local-development-secret-only";

export function resolveAuthSecret(
  value: string | undefined,
  environment: string | undefined,
): string {
  if (value && value.length >= MINIMUM_AUTH_SECRET_LENGTH) return value;

  if (environment === "production") {
    throw new Error("AUTH_SECRET must contain at least 32 characters in production.");
  }

  return DEVELOPMENT_ONLY_SECRET;
}

// Resolve the signing key lazily (at request time) rather than at module
// evaluation. Eager evaluation made `next build` fail during page-data
// collection: with NODE_ENV=production and AUTH_SECRET unset, importing this
// module threw before any request ran. Deferring the read keeps the build
// green while still failing closed the moment a request needs a signing key.
export function getAuthSigningKey(): Uint8Array {
  return new TextEncoder().encode(
    resolveAuthSecret(process.env.AUTH_SECRET, process.env.NODE_ENV),
  );
}
