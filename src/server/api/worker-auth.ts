import { timingSafeEqual } from "node:crypto";

import { authenticationRequiredProblem } from "@/server/supabase/http";

// Shared-secret guard for internal worker routes (notification dispatch, webhook
// processing, watchdog). These routes are NOT reachable by staff sessions: there is
// no cookie/CSRF flow — a caller must present `Authorization: Bearer <WORKER_SECRET>`.
// The compare is constant-time and fails closed when the secret is missing or is a
// deploy placeholder, so a mis-provisioned environment cannot silently accept every
// request.

const PLACEHOLDER_PREFIX = "replace-with-";

function constantTimeEquals(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, "utf8");
  const bufferB = Buffer.from(b, "utf8");
  if (bufferA.length !== bufferB.length) {
    timingSafeEqual(bufferA, bufferA);
    return false;
  }
  return timingSafeEqual(bufferA, bufferB);
}

function extractBearer(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const [scheme, ...rest] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer") return null;
  const token = rest.join(" ").trim();
  return token.length > 0 ? token : null;
}

export function isWorkerAuthorized(request: Request): boolean {
  const secret = process.env.WORKER_SECRET?.trim();
  if (!secret || secret.startsWith(PLACEHOLDER_PREFIX)) return false;

  const token = extractBearer(request);
  if (!token) return false;

  return constantTimeEquals(token, secret);
}

export function assertWorkerAuthorized(request: Request): void {
  if (!isWorkerAuthorized(request)) {
    throw authenticationRequiredProblem();
  }
}
