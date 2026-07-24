import { createHash, createHmac } from "node:crypto";
import { isIP } from "node:net";

import { ApiProblem } from "@/server/api/problem";

const PUBLIC_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function publicLinkNotFound(): ApiProblem {
  return new ApiProblem({
    status: 404,
    code: "PUBLIC_LINK_NOT_FOUND",
    title: "連結無法使用",
    detail: "此連結不存在、已過期或已被撤銷。",
  });
}

export function requirePublicToken(candidate: string): string {
  if (!PUBLIC_TOKEN_PATTERN.test(candidate)) {
    throw publicLinkNotFound();
  }

  return candidate;
}

export function requirePublicBearerToken(request: Request): string {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    throw publicLinkNotFound();
  }
  const candidate = authorization.slice("Bearer ".length);
  if (candidate.includes(" ")) {
    throw publicLinkNotFound();
  }
  return requirePublicToken(candidate);
}

export function hashPublicToken(token: string): string {
  return createHash("sha256").update(requirePublicToken(token), "utf8").digest("hex");
}

// Number of proxy hops appended *after* the client address. On a platform such
// as Vercel the edge appends the real peer as the right-most entry, so the
// default of 0 keys on the right-most value. Deployments that chain additional
// trusted proxies raise this so those extra right-most entries are skipped.
const DEFAULT_TRUSTED_PROXY_HOPS = 0;
const MAX_XFF_ENTRIES = 20;

function trustedProxyHops(): number {
  const raw = process.env.PUBLIC_TRUSTED_PROXY_COUNT;
  if (!raw || !/^\d{1,2}$/.test(raw)) {
    return DEFAULT_TRUSTED_PROXY_HOPS;
  }
  return Number(raw);
}

function validIp(candidate: string | undefined): string | null {
  if (!candidate) return null;
  const trimmed = candidate.trim();
  return trimmed.length > 0 && trimmed.length <= 64 && isIP(trimmed) ? trimmed : null;
}

/**
 * Resolve the untrusted client address in a way that a client cannot forge.
 *
 * `X-Forwarded-For` is appended left-to-right, so the right-most entry is the one
 * our own trusted edge added (the real peer it observed) and the left-most
 * entries are attacker-controlled. We therefore start from the right, skip
 * `PUBLIC_TRUSTED_PROXY_COUNT` additional trusted-proxy hops, and key on the
 * first entry we reach. If the chain is shorter than the configured depth (e.g. a
 * forged single-entry header claiming more hops than exist) we fall back to the
 * left-most parseable value, which is no weaker than having no proxy at all.
 * This defends against forgery only to the extent the deployment really places
 * exactly that many trusted proxies in front of the app.
 */
export function resolveClientIp(request: Request): string {
  const forwardedHeader = request.headers.get("x-forwarded-for");
  if (forwardedHeader) {
    // Keep the RIGHT-most entries: the trusted edge appends the real peer at
    // the end, so truncating from the left can only drop attacker-prepended
    // hops, never the trusted one.
    const entries = forwardedHeader
      .split(",")
      .slice(-MAX_XFF_ENTRIES)
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);

    if (entries.length > 0) {
      const skip = trustedProxyHops();
      const untrustedIndex = entries.length > skip ? entries.length - 1 - skip : 0;
      const candidate = validIp(entries[untrustedIndex]);
      if (candidate) {
        return candidate;
      }
    }
  }

  const realIp = validIp(request.headers.get("x-real-ip") ?? undefined);
  if (realIp) {
    return realIp;
  }

  return "unknown";
}

export function hashClientIp(request: Request, pepper: string): string {
  if (Buffer.byteLength(pepper, "utf8") < 32) {
    throw new Error("PUBLIC_TOKEN_PEPPER must contain at least 32 bytes");
  }

  return createHmac("sha256", pepper).update(resolveClientIp(request), "utf8").digest("hex");
}
