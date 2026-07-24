import { createPaymentMilestoneSchema, listPaymentMilestonesQuerySchema } from "@/schemas/payment-milestone";
import { configuredAppOrigin, verifyCsrf } from "@/server/api/csrf";
import { authenticateAndRateLimit, parseUuidParam } from "@/server/api/operations-route";
import { ApiProblem } from "@/server/api/problem";
import { parseJsonBody, resolveRequestId } from "@/server/api/request";
import { createPaymentMilestone, listPaymentMilestones } from "@/server/payments/gateway";
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
    const query = listPaymentMilestonesQuerySchema.safeParse({
      projectId: url.searchParams.get("projectId") ?? undefined,
      status: url.searchParams.get("status") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
    });
    if (!query.success) throw ApiProblem.fromZod(query.error);

    const supabase = await createSupabaseServerClient();
    await authenticateAndRateLimit(supabase, organizationId, "read");

    const data = await listPaymentMilestones({
      supabase,
      organizationId,
      projectId: query.data.projectId ?? null,
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
    const body = await parseJsonBody(request, createPaymentMilestoneSchema);

    const supabase = await createSupabaseServerClient();
    await authenticateAndRateLimit(supabase, organizationId, "mutation");

    const data = await createPaymentMilestone({
      supabase,
      organizationId,
      input: body,
      requestId,
    });
    return apiJsonResponse(
      { data },
      { status: 201, requestId, headers: etagFrom(data) },
    );
  } catch (error) {
    const safeError = error instanceof ApiProblem ? error : internalApiProblem();
    return apiProblemResponse(safeError, request, requestId);
  }
}

function etagFrom(data: Record<string, unknown>): Record<string, string> {
  const lockVersion = data.lockVersion;
  return typeof lockVersion === "number" ? { etag: `"${lockVersion}"` } : {};
}
