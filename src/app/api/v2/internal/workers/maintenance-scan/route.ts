import { z } from "zod";

import { assertWorkerAuthorized } from "@/server/api/worker-auth";
import { ApiProblem } from "@/server/api/problem";
import { resolveRequestId } from "@/server/api/request";
import { scanMaintenanceDue } from "@/server/maintenance/gateway";
import { createAdminSupabaseClient } from "@/server/supabase/admin";
import { apiJsonResponse, apiProblemResponse, internalApiProblem } from "@/server/supabase/http";

// Internal daily worker: scan due maintenance plans (org-tz next_due_on/lead_days)
// and enqueue ONE approval-pending revisit reminder per due plan via the M6 outbox.
// Worker-secret guarded; the RPC is idempotent so re-running does not double-enqueue.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z
  .object({ limit: z.number().int().min(1).max(2_000).optional() })
  .strict();

export async function POST(request: Request): Promise<Response> {
  const requestId = resolveRequestId(request.headers.get("x-request-id"));
  try {
    assertWorkerAuthorized(request);

    let limit: number | undefined;
    const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
    if (contentType.startsWith("application/json")) {
      const raw = await request.text();
      if (raw.trim().length > 0) {
        const parsed = bodySchema.safeParse(JSON.parse(raw));
        if (!parsed.success) throw ApiProblem.fromZod(parsed.error);
        limit = parsed.data.limit;
      }
    }

    const supabase = createAdminSupabaseClient();
    const data = await scanMaintenanceDue({ supabase, limit });
    return apiJsonResponse({ data }, { requestId });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return apiProblemResponse(
        new ApiProblem({
          status: 400,
          code: "MALFORMED_REQUEST",
          title: "要求格式錯誤",
          detail: "Request body must be valid JSON.",
        }),
        request,
        requestId,
      );
    }
    const safeError = error instanceof ApiProblem ? error : internalApiProblem();
    return apiProblemResponse(safeError, request, requestId);
  }
}
