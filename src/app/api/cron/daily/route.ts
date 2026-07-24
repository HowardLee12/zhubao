import { timingSafeEqual } from "node:crypto";

/**
 * Vercel Cron dispatcher for the internal background workers.
 *
 * Vercel Cron can only issue a GET and authenticates itself with its own
 * `CRON_SECRET` (sent as `Authorization: Bearer <CRON_SECRET>`), whereas the
 * worker routes are POST + `WORKER_SECRET`. This thin dispatcher bridges the two:
 * it verifies the Vercel cron secret, then server-side POSTs each worker with the
 * `WORKER_SECRET` bearer. A worker failure is logged into the response summary but
 * never aborts the others, so one bad worker cannot starve the rest.
 *
 * Hobby-plan note: Vercel Hobby allows a cron to run at most ONCE PER DAY and at
 * most 2 crons total, so every worker is bundled into this one daily pass. That is
 * fine for the M8 daily jobs (overdue, revisit scan, retention cleanup) but means
 * M6 LINE notifications and inbound webhook processing are delayed up to ~24h.
 * To make notifications near-real-time, upgrade to Vercel Pro and split
 * notification-dispatch + webhook-process into their own per-minute cron entries
 * in vercel.json (schedule "* * * * *"), or drive those two from an external
 * scheduler (GitHub Actions / cron-job.org) POSTing the worker routes with the
 * WORKER_SECRET bearer.
 */

export const dynamic = "force-dynamic";
// Workers claim/process in bounded batches; give the pass room without hanging.
export const maxDuration = 60;

// Order matters: extract drafts and process inbound webhooks before dispatching
// outbound notifications, then run the daily housekeeping jobs.
const WORKER_PATHS = [
  "/api/v2/internal/workers/webhook-process",
  "/api/v2/internal/workers/intake-extraction",
  "/api/v2/internal/workers/notification-dispatch",
  "/api/v2/internal/workers/payment-overdue",
  "/api/v2/internal/workers/maintenance-scan",
  "/api/v2/internal/workers/retention-cleanup",
] as const;

function bearerOf(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const [scheme, ...rest] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer") return null;
  const token = rest.join(" ").trim();
  return token.length > 0 ? token : null;
}

function constantTimeEquals(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, "utf8");
  const bufferB = Buffer.from(b, "utf8");
  if (bufferA.length !== bufferB.length) {
    timingSafeEqual(bufferA, bufferA);
    return false;
  }
  return timingSafeEqual(bufferA, bufferB);
}

function unauthorized(): Response {
  return Response.json({ error: "unauthorized" }, { status: 401 });
}

export async function GET(request: Request): Promise<Response> {
  const cronSecret = process.env.CRON_SECRET?.trim();
  const workerSecret = process.env.WORKER_SECRET?.trim();
  // Fail closed: without both secrets the dispatcher cannot authenticate Vercel
  // or call the workers, so refuse rather than silently no-op.
  if (!cronSecret || !workerSecret) {
    return Response.json({ error: "cron_not_configured" }, { status: 500 });
  }

  const presented = bearerOf(request);
  if (!presented || !constantTimeEquals(presented, cronSecret)) {
    return unauthorized();
  }

  const origin = new URL(request.url).origin;
  const results: Array<{ worker: string; status: number | "error" }> = [];

  for (const path of WORKER_PATHS) {
    try {
      const response = await fetch(`${origin}${path}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${workerSecret}`,
          "content-type": "application/json",
        },
        body: "{}",
      });
      results.push({ worker: path, status: response.status });
    } catch {
      results.push({ worker: path, status: "error" });
    }
  }

  return Response.json({ ran: results.length, results });
}
