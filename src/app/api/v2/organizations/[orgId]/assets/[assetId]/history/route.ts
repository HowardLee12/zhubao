import { assetHistoryQuerySchema } from "@/schemas/asset";
import { authenticateAndRateLimit, parseUuidParam } from "@/server/api/operations-route";
import { ApiProblem } from "@/server/api/problem";
import { resolveRequestId } from "@/server/api/request";
import { getAssetHistory } from "@/server/assets/gateway";
import { apiJsonResponse, apiProblemResponse, internalApiProblem } from "@/server/supabase/http";
import { createSupabaseServerClient } from "@/server/supabase/server";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ orgId: string; assetId: string }>;
}

// Cursor-merged asset history: append-only events + related work-order summaries.
// Assigned technicians may read their own asset history; the projection carries no
// cost/amount.
export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const requestId = resolveRequestId(request.headers.get("x-request-id"));
  try {
    const { orgId, assetId } = await context.params;
    const organizationId = parseUuidParam(orgId);
    const assetIdParsed = parseUuidParam(assetId);
    const url = new URL(request.url);
    const query = assetHistoryQuerySchema.safeParse({
      limit: url.searchParams.get("limit") ?? undefined,
    });
    if (!query.success) throw ApiProblem.fromZod(query.error);

    const supabase = await createSupabaseServerClient();
    await authenticateAndRateLimit(supabase, organizationId, "read");

    const data = await getAssetHistory({
      supabase,
      organizationId,
      assetId: assetIdParsed,
      limit: query.data.limit,
    });
    return apiJsonResponse({ data }, { requestId });
  } catch (error) {
    const safeError = error instanceof ApiProblem ? error : internalApiProblem();
    return apiProblemResponse(safeError, request, requestId);
  }
}
