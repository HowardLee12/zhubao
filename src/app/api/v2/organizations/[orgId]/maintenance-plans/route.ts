import { createMaintenancePlanSchema, listMaintenancePlansQuerySchema } from "@/schemas/maintenance-plan";
import { configuredAppOrigin, verifyCsrf } from "@/server/api/csrf";
import { authenticateAndRateLimit, parseUuidParam } from "@/server/api/operations-route";
import { ApiProblem } from "@/server/api/problem";
import { parseJsonBody, resolveRequestId } from "@/server/api/request";
import { createMaintenancePlan, listMaintenancePlans } from "@/server/maintenance/gateway";
import { apiJsonResponse, apiProblemResponse, internalApiProblem } from "@/server/supabase/http";
import { createSupabaseServerClient } from "@/server/supabase/server";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ orgId: string }>;
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const requestId = resolveRequestId(request.headers.get("x-request-id"));
  try {
    const organizationId = parseUuidParam((await context.params).orgId);
    const url = new URL(request.url);
    const query = listMaintenancePlansQuerySchema.safeParse({
      status: url.searchParams.get("status") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
    });
    if (!query.success) throw ApiProblem.fromZod(query.error);

    const supabase = await createSupabaseServerClient();
    await authenticateAndRateLimit(supabase, organizationId, "read");

    const data = await listMaintenancePlans({
      supabase,
      organizationId,
      status: query.data.status ?? null,
      limit: query.data.limit,
    });
    return apiJsonResponse({ data }, { requestId });
  } catch (error) {
    const safeError = error instanceof ApiProblem ? error : internalApiProblem();
    return apiProblemResponse(safeError, request, requestId);
  }
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const requestId = resolveRequestId(request.headers.get("x-request-id"));
  try {
    verifyCsrf(request, configuredAppOrigin(request));
    const organizationId = parseUuidParam((await context.params).orgId);
    const body = await parseJsonBody(request, createMaintenancePlanSchema);

    const supabase = await createSupabaseServerClient();
    await authenticateAndRateLimit(supabase, organizationId, "mutation");

    const data = await createMaintenancePlan({ supabase, organizationId, input: body, requestId });
    const lockVersion = data.lockVersion;
    return apiJsonResponse(
      { data },
      {
        status: 201,
        requestId,
        headers: typeof lockVersion === "number" ? { etag: `"${lockVersion}"` } : {},
      },
    );
  } catch (error) {
    const safeError = error instanceof ApiProblem ? error : internalApiProblem();
    return apiProblemResponse(safeError, request, requestId);
  }
}
