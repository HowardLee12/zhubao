import { patchAssetSchema, retireAssetSchema } from "@/schemas/asset";
import { configuredAppOrigin, verifyCsrf } from "@/server/api/csrf";
import { parseIfMatch } from "@/server/api/headers";
import { authenticateAndRateLimit, parseUuidParam } from "@/server/api/operations-route";
import { ApiProblem } from "@/server/api/problem";
import { parseJsonBody, resolveRequestId } from "@/server/api/request";
import { getAssetHistory, patchAsset, retireAsset } from "@/server/assets/gateway";
import { apiJsonResponse, apiProblemResponse, internalApiProblem } from "@/server/supabase/http";
import { createSupabaseServerClient } from "@/server/supabase/server";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ orgId: string; assetId: string }>;
}

function etagHeaders(data: Record<string, unknown>): Record<string, string> {
  const lockVersion = data.lockVersion;
  return typeof lockVersion === "number" ? { etag: `"${lockVersion}"` } : {};
}

// GET returns just the asset row (from the history projection's asset field). The
// asset DTO carries no cost/amount, so it is safe for the technician surface.
export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const requestId = resolveRequestId(request.headers.get("x-request-id"));
  try {
    const { orgId, assetId } = await context.params;
    const organizationId = parseUuidParam(orgId);
    const assetIdParsed = parseUuidParam(assetId);

    const supabase = await createSupabaseServerClient();
    await authenticateAndRateLimit(supabase, organizationId, "read");

    const history = await getAssetHistory({
      supabase,
      organizationId,
      assetId: assetIdParsed,
      limit: 1,
    });
    const asset = (history.asset ?? {}) as Record<string, unknown>;
    return apiJsonResponse({ data: asset }, { requestId, headers: etagHeaders(asset) });
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
    const { orgId, assetId } = await context.params;
    const organizationId = parseUuidParam(orgId);
    const assetIdParsed = parseUuidParam(assetId);
    const body = await parseJsonBody(request, patchAssetSchema);

    const supabase = await createSupabaseServerClient();
    await authenticateAndRateLimit(supabase, organizationId, "mutation");

    const data = await patchAsset({
      supabase,
      organizationId,
      assetId: assetIdParsed,
      expectedLockVersion,
      input: body,
      requestId,
    });
    return apiJsonResponse({ data }, { requestId, headers: etagHeaders(data) });
  } catch (error) {
    const safeError = error instanceof ApiProblem ? error : internalApiProblem();
    return apiProblemResponse(safeError, request, requestId);
  }
}

// DELETE = retire (soft delete). The history is preserved. Owner/admin only
// (enforced in the RPC).
export async function DELETE(request: Request, context: RouteContext): Promise<Response> {
  const requestId = resolveRequestId(request.headers.get("x-request-id"));
  try {
    verifyCsrf(request, configuredAppOrigin(request));
    const expectedLockVersion = parseIfMatch(request.headers.get("if-match"));
    const { orgId, assetId } = await context.params;
    const organizationId = parseUuidParam(orgId);
    const assetIdParsed = parseUuidParam(assetId);
    const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
    const body = contentType.startsWith("application/json")
      ? await parseJsonBody(request, retireAssetSchema)
      : retireAssetSchema.parse({});

    const supabase = await createSupabaseServerClient();
    await authenticateAndRateLimit(supabase, organizationId, "mutation");

    const data = await retireAsset({
      supabase,
      organizationId,
      assetId: assetIdParsed,
      expectedLockVersion,
      input: body,
      requestId,
    });
    return apiJsonResponse({ data }, { requestId, headers: etagHeaders(data) });
  } catch (error) {
    const safeError = error instanceof ApiProblem ? error : internalApiProblem();
    return apiProblemResponse(safeError, request, requestId);
  }
}
