import { finalizeDataDeletionSchema } from "@/schemas/data-deletion";
import { configuredAppOrigin, verifyCsrf } from "@/server/api/csrf";
import { authenticateAndRateLimit, parseUuidParam } from "@/server/api/operations-route";
import { ApiProblem } from "@/server/api/problem";
import { parseJsonBody, resolveRequestId } from "@/server/api/request";
import { finalizeDataDeletion } from "@/server/reporting/gateway";
import { apiJsonResponse, apiProblemResponse, internalApiProblem } from "@/server/supabase/http";
import { createSupabaseServerClient } from "@/server/supabase/server";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ orgId: string }>;
}

// Owner-only. Re-auth compared against the stored digest; on match, anonymizes
// only this org's customer names/phones/emails/addresses while keeping the
// transaction ids needed for audit. Confirm-once: a replay after finalization
// returns the recorded summary.
export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const requestId = resolveRequestId(request.headers.get("x-request-id"));
  try {
    verifyCsrf(request, configuredAppOrigin(request));
    const organizationId = parseUuidParam((await context.params).orgId);
    const body = await parseJsonBody(request, finalizeDataDeletionSchema);

    const supabase = await createSupabaseServerClient();
    await authenticateAndRateLimit(supabase, organizationId, "mutation");

    const data = await finalizeDataDeletion({
      supabase,
      organizationId,
      deletionRequestId: body.deletionRequestId,
      reauthToken: body.reauthToken,
      occurredAt: body.occurredAt,
      requestId,
    });
    return apiJsonResponse({ data }, { requestId });
  } catch (error) {
    const safeError = error instanceof ApiProblem ? error : internalApiProblem();
    return apiProblemResponse(safeError, request, requestId);
  }
}
