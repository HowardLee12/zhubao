import { appendAssetServiceEventSchema } from "@/schemas/asset";
import { configuredAppOrigin, verifyCsrf } from "@/server/api/csrf";
import { authenticateAndRateLimit, parseUuidParam } from "@/server/api/operations-route";
import { ApiProblem } from "@/server/api/problem";
import { parseJsonBody, resolveRequestId } from "@/server/api/request";
import { appendAssetServiceEvent } from "@/server/assets/gateway";
import { apiJsonResponse, apiProblemResponse, internalApiProblem } from "@/server/supabase/http";
import { createSupabaseServerClient } from "@/server/supabase/server";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ orgId: string; assetId: string }>;
}

// Append an append-only service event to an asset. It records a human-authored
// note; it never contains cost.
export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const requestId = resolveRequestId(request.headers.get("x-request-id"));
  try {
    verifyCsrf(request, configuredAppOrigin(request));
    const { orgId, assetId } = await context.params;
    const organizationId = parseUuidParam(orgId);
    const assetIdParsed = parseUuidParam(assetId);
    const body = await parseJsonBody(request, appendAssetServiceEventSchema);

    const supabase = await createSupabaseServerClient();
    await authenticateAndRateLimit(supabase, organizationId, "mutation");

    const data = await appendAssetServiceEvent({
      supabase,
      organizationId,
      assetId: assetIdParsed,
      input: body,
      requestId,
    });
    return apiJsonResponse({ data }, { status: 201, requestId });
  } catch (error) {
    const safeError = error instanceof ApiProblem ? error : internalApiProblem();
    return apiProblemResponse(safeError, request, requestId);
  }
}
