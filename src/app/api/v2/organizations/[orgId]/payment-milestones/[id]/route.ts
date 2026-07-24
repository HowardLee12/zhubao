import { authenticateAndRateLimit, parseUuidParam } from "@/server/api/operations-route";
import { ApiProblem } from "@/server/api/problem";
import { resolveRequestId } from "@/server/api/request";
import { getPaymentMilestoneDetail } from "@/server/payments/gateway";
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
    const milestoneId = parseUuidParam(id);

    const supabase = await createSupabaseServerClient();
    await authenticateAndRateLimit(supabase, organizationId, "read");

    const data = await getPaymentMilestoneDetail({ supabase, organizationId, milestoneId });
    const lockVersion = data.lockVersion;
    return apiJsonResponse(
      { data },
      {
        requestId,
        headers: typeof lockVersion === "number" ? { etag: `"${lockVersion}"` } : {},
      },
    );
  } catch (error) {
    const safeError = error instanceof ApiProblem ? error : internalApiProblem();
    return apiProblemResponse(safeError, request, requestId);
  }
}
