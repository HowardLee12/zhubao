import { convertMaintenancePlanSchema } from "@/schemas/maintenance-plan";
import { configuredAppOrigin, verifyCsrf } from "@/server/api/csrf";
import { parseIfMatch, resolveStaffIdempotencyKey } from "@/server/api/headers";
import { authenticateAndRateLimit, parseUuidParam } from "@/server/api/operations-route";
import { ApiProblem } from "@/server/api/problem";
import { parseJsonBody, resolveRequestId } from "@/server/api/request";
import { convertMaintenancePlanToRequest } from "@/server/maintenance/gateway";
import { apiJsonResponse, apiProblemResponse, internalApiProblem } from "@/server/supabase/http";
import { createSupabaseServerClient } from "@/server/supabase/server";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ orgId: string; id: string }>;
}

// One-click revisit -> new service_request (source=revisit, origin linkage, no
// copied photos). force=false raises a 409 when the asset already has an open
// request; the staff must confirm before force-creating.
export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const requestId = resolveRequestId(request.headers.get("x-request-id"));
  try {
    verifyCsrf(request, configuredAppOrigin(request));
    const expectedLockVersion = parseIfMatch(request.headers.get("if-match"));
    const idempotencyKey = resolveStaffIdempotencyKey(request.headers.get("idempotency-key"));
    const { orgId, id } = await context.params;
    const organizationId = parseUuidParam(orgId);
    const planId = parseUuidParam(id);
    const body = await parseJsonBody(request, convertMaintenancePlanSchema);

    const supabase = await createSupabaseServerClient();
    await authenticateAndRateLimit(supabase, organizationId, "mutation");

    const data = await convertMaintenancePlanToRequest({
      supabase,
      organizationId,
      planId,
      expectedLockVersion,
      input: body,
      idempotencyKey,
      requestId,
    });
    const status = data.replayed === true ? 200 : 201;
    return apiJsonResponse({ data }, { status, requestId });
  } catch (error) {
    const safeError = error instanceof ApiProblem ? error : internalApiProblem();
    return apiProblemResponse(safeError, request, requestId);
  }
}
