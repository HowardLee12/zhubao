import { z } from "zod";

const STAFF_HOME = "/app";
const DEV_ORIGIN = "http://localhost:3000";

// host[:port] only — letters, digits, dots, hyphens, optional numeric port.
// Rejects paths, credentials, whitespace, and other injection vectors.
const hostPattern = /^[a-z0-9.-]+(?::\d{1,5})?$/i;

const appUrlSchema = z
  .string()
  .trim()
  .min(1)
  .transform((value, ctx) => {
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "invalid url" });
      return z.NEVER;
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "unsupported protocol" });
      return z.NEVER;
    }
    return parsed.origin;
  });

function firstForwardedValue(header: string | null): string | null {
  if (!header) {
    return null;
  }
  const first = header.split(",")[0]?.trim();
  return first ? first : null;
}

function originFromRequest(request: Request): string | null {
  const forwardedHost = firstForwardedValue(
    request.headers.get("x-forwarded-host"),
  );
  const host = forwardedHost ?? request.headers.get("host");
  if (!host || !hostPattern.test(host)) {
    return null;
  }

  const forwardedProto = firstForwardedValue(
    request.headers.get("x-forwarded-proto"),
  );
  const proto =
    forwardedProto === "https" || forwardedProto === "http"
      ? forwardedProto
      : "http";

  try {
    return new URL(`${proto}://${host}`).origin;
  } catch {
    return null;
  }
}

/**
 * Resolve the origin used to build staff-facing redirect URLs.
 *
 * Order of trust:
 *   1. A validated NEXT_PUBLIC_APP_URL (http/https only).
 *   2. The request's Host / X-Forwarded-Host + proto headers, allowlist-parsed.
 *   3. A localhost dev fallback (non-production only).
 *
 * The raw `request.url` is never used for the origin: in Next dev the
 * route-handler request URL is normalized to `localhost`, which would send the
 * 307 to a host where the freshly-set session cookies do not live (defect D1).
 */
export function applicationOrigin(request?: Request): string {
  const configured = appUrlSchema.safeParse(process.env.NEXT_PUBLIC_APP_URL);
  if (configured.success) {
    return configured.data;
  }

  if (request) {
    const fromRequest = originFromRequest(request);
    if (fromRequest) {
      return fromRequest;
    }
  }

  if (process.env.NODE_ENV !== "production") {
    return DEV_ORIGIN;
  }

  throw new Error("NEXT_PUBLIC_APP_URL is not configured.");
}

/**
 * Clamp a `next` candidate to the internal staff area, never an open redirect.
 * Returns the default staff home unless the candidate is `/app` or `/app/...`
 * with a safe path, search, and hash.
 */
export function safeStaffPath(candidate: string | null): string {
  if (
    !candidate ||
    (candidate !== STAFF_HOME && !candidate.startsWith("/app/"))
  ) {
    return STAFF_HOME;
  }

  if (candidate.startsWith("//") || candidate.includes("\\")) {
    return STAFF_HOME;
  }

  try {
    const parsed = new URL(candidate, "https://renoly.invalid");
    if (
      parsed.origin !== "https://renoly.invalid" ||
      (parsed.pathname !== STAFF_HOME && !parsed.pathname.startsWith("/app/"))
    ) {
      return STAFF_HOME;
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return STAFF_HOME;
  }
}
