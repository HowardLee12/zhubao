import { timingSafeEqual } from "node:crypto";

import { ApiProblem } from "./problem";

export const CSRF_COOKIE_NAME = "renoly-csrf";
export const CSRF_HEADER_NAME = "x-csrf-token";

// Double-submit tokens are 32 random bytes encoded base64url (43 chars). We
// enforce a minimum length so an empty/placeholder value can never be accepted
// by a reflected empty cookie + empty header.
const MIN_TOKEN_LENGTH = 32;
const MAX_TOKEN_LENGTH = 200;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,200}$/;

function csrfInvalid(): ApiProblem {
  return new ApiProblem({
    status: 403,
    code: "CSRF_INVALID",
    title: "要求驗證失敗",
    detail: "請重新整理頁面後再試一次。",
  });
}

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      return part.slice(eq + 1).trim();
    }
  }
  return null;
}

function constantTimeEquals(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, "utf8");
  const bufferB = Buffer.from(b, "utf8");
  if (bufferA.length !== bufferB.length) {
    // Compare against self to keep the timing profile independent of which side
    // differs, then still reject.
    timingSafeEqual(bufferA, bufferA);
    return false;
  }
  return timingSafeEqual(bufferA, bufferB);
}

/**
 * The configured application origin used for CSRF Origin/Host validation.
 *
 * Trust order: (1) a validated `NEXT_PUBLIC_APP_URL`, (2) the request's own URL
 * origin as a dev/local fallback only. Forwarded headers are deliberately NOT
 * trusted here — an attacker-supplied `X-Forwarded-Host` must never define the
 * origin we compare against. In production behind a TLS-terminating proxy,
 * `request.url` may not reflect the public origin, which would turn every staff
 * mutation into a misleading 403 — so a missing/invalid `NEXT_PUBLIC_APP_URL`
 * fails loudly instead of degrading.
 */
export function configuredAppOrigin(request: Request): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  const fromEnv = configured ? normalizeOrigin(configured) : null;
  if (fromEnv) return fromEnv;
  if (process.env.NODE_ENV === "production") {
    throw new ApiProblem({
      status: 500,
      code: "CONFIG_INVALID",
      title: "伺服器設定不完整",
      detail: "NEXT_PUBLIC_APP_URL 未設定或無效，無法驗證要求來源。",
    });
  }
  return new URL(request.url).origin;
}

function normalizeOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * Verify a cookie-authenticated mutating request per docs/security.md §4.3:
 *
 * 1. Origin must exactly equal the configured app origin; when absent, fall back
 *    to Host with a `Sec-Fetch-Site` of same-origin.
 * 2. A double-submit CSRF token: the `X-CSRF-Token` header must be present, well
 *    formed, and match the `renoly-csrf` cookie via constant-time compare.
 *
 * Any failure raises a 403 `CSRF_INVALID` problem before the domain service runs.
 *
 * NOTE: this is the double-submit-cookie variant of §4.3. It is stateless and not
 * yet bound to a server-side session token store; see the task handoff for the
 * documented delta from the full synchronizer-token scheme.
 */
export function verifyCsrf(request: Request, appOrigin: string): void {
  const expectedOrigin = normalizeOrigin(appOrigin);
  if (!expectedOrigin) {
    throw csrfInvalid();
  }

  const originHeader = request.headers.get("origin");
  if (originHeader) {
    if (normalizeOrigin(originHeader) !== expectedOrigin) {
      throw csrfInvalid();
    }
  } else {
    const host = request.headers.get("host");
    const secFetchSite = request.headers.get("sec-fetch-site");
    const expectedHost = new URL(expectedOrigin).host;
    if (host !== expectedHost || secFetchSite !== "same-origin") {
      throw csrfInvalid();
    }
  }

  const headerToken = request.headers.get(CSRF_HEADER_NAME);
  const cookieToken = readCookie(request, CSRF_COOKIE_NAME);
  if (
    !headerToken ||
    !cookieToken ||
    headerToken.length < MIN_TOKEN_LENGTH ||
    headerToken.length > MAX_TOKEN_LENGTH ||
    !TOKEN_PATTERN.test(headerToken) ||
    !constantTimeEquals(headerToken, cookieToken)
  ) {
    throw csrfInvalid();
  }
}
