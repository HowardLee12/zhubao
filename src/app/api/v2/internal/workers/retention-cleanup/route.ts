import { assertWorkerAuthorized } from "@/server/api/worker-auth";
import { ApiProblem } from "@/server/api/problem";
import { resolveRequestId } from "@/server/api/request";
import { runRetentionCleanup } from "@/server/reporting/gateway";
import { createAdminSupabaseClient } from "@/server/supabase/admin";
import { apiJsonResponse, apiProblemResponse, internalApiProblem } from "@/server/supabase/http";

// Internal daily worker: purge expired uploads, strip raw webhook payloads (90d)
// and clean finalized deletion export artifacts. Worker-secret guarded; auth is
// checked before any work.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const requestId = resolveRequestId(request.headers.get("x-request-id"));
  try {
    assertWorkerAuthorized(request);

    const supabase = createAdminSupabaseClient();
    const data = await runRetentionCleanup({ supabase });
    return apiJsonResponse({ data }, { requestId });
  } catch (error) {
    const safeError = error instanceof ApiProblem ? error : internalApiProblem();
    return apiProblemResponse(safeError, request, requestId);
  }
}
