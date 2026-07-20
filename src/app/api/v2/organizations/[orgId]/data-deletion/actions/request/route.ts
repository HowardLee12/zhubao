import { requestDataDeletionSchema } from "@/schemas/data-deletion";
import { configuredAppOrigin, verifyCsrf } from "@/server/api/csrf";
import { authenticateAndRateLimit, parseUuidParam } from "@/server/api/operations-route";
import { ApiProblem } from "@/server/api/problem";
import { parseJsonBody, resolveRequestId } from "@/server/api/request";
import { requestDataDeletion } from "@/server/reporting/gateway";
import { apiJsonResponse, apiProblemResponse, internalApiProblem } from "@/server/supabase/http";
import { createSupabaseServerClient } from "@/server/supabase/server";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ orgId: string }>;
}

// Owner-only. The route hashes the owner re-auth material before it reaches the
// RPC; the raw token never leaves the Node boundary. The RPC gates owner and
// stores the digest for the finalize comparison.
export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const requestId = resolveRequestId(request.headers.get("x-request-id"));
  try {
    verifyCsrf(request, configuredAppOrigin(request));
    const organizationId = parseUuidParam((await context.params).orgId);
    const body = await parseJsonBody(request, requestDataDeletionSchema);

    const supabase = await createSupabaseServerClient();
    await authenticateAndRateLimit(supabase, organizationId, "mutation");

    const data = await requestDataDeletion({
      supabase,
      organizationId,
      reauthToken: body.reauthToken,
      occurredAt: body.occurredAt,
      requestId,
    });
    return apiJsonResponse({ data }, { status: 202, requestId });
  } catch (error) {
    const safeError = error instanceof ApiProblem ? error : internalApiProblem();
    return apiProblemResponse(safeError, request, requestId);
  }
}
