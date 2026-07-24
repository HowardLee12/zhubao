import { patchMaintenancePlanSchema } from "@/schemas/maintenance-plan";
import { configuredAppOrigin, verifyCsrf } from "@/server/api/csrf";
import { parseIfMatch } from "@/server/api/headers";
import { authenticateAndRateLimit, parseUuidParam } from "@/server/api/operations-route";
import { ApiProblem } from "@/server/api/problem";
import { parseJsonBody, resolveRequestId } from "@/server/api/request";
import { getMaintenancePlanDetail, patchMaintenancePlan } from "@/server/maintenance/gateway";
import { apiJsonResponse, apiProblemResponse, internalApiProblem } from "@/server/supabase/http";
import { createSupabaseServerClient } from "@/server/supabase/server";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ orgId: string; id: string }>;
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const requestId = resolveRequestId(request.headers.get("x-request-id"));
  try {
    const { orgId, id } = await context.params;
    const organizationId = parseUuidParam(orgId);
    const planId = parseUuidParam(id);

    const supabase = await createSupabaseServerClient();
    await authenticateAndRateLimit(supabase, organizationId, "read");

    const data = await getMaintenancePlanDetail({ supabase, organizationId, planId });
    const lockVersion = data.lockVersion;
    return apiJsonResponse(
      { data },
      { requestId, headers: typeof lockVersion === "number" ? { etag: `"${lockVersion}"` } : {} },
    );
  } catch (error) {
    const safeError = error instanceof ApiProblem ? error : internalApiProblem();
    return apiProblemResponse(safeError, request, requestId);
  }
}

export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  const requestId = resolveRequestId(request.headers.get("x-request-id"));
  try {
    verifyCsrf(request, configuredAppOrigin(request));
    const expectedLockVersion = parseIfMatch(request.headers.get("if-match"));
    const { orgId, id } = await context.params;
    const organizationId = parseUuidParam(orgId);
    const planId = parseUuidParam(id);
    const body = await parseJsonBody(request, patchMaintenancePlanSchema);

    const supabase = await createSupabaseServerClient();
    await authenticateAndRateLimit(supabase, organizationId, "mutation");

    const data = await patchMaintenancePlan({
      supabase,
      organizationId,
      planId,
      expectedLockVersion,
      input: body,
      requestId,
    });
    const lockVersion = data.lockVersion;
    return apiJsonResponse(
      { data },
      { requestId, headers: typeof lockVersion === "number" ? { etag: `"${lockVersion}"` } : {} },
    );
  } catch (error) {
    const safeError = error instanceof ApiProblem ? error : internalApiProblem();
    return apiProblemResponse(safeError, request, requestId);
  }
}
