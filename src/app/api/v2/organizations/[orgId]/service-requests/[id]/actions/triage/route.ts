import { z } from "zod";

import { triageRequestSchema } from "@/schemas/triage";
import { configuredAppOrigin, verifyCsrf } from "@/server/api/csrf";
import { parseIfMatch } from "@/server/api/headers";
import { ApiProblem } from "@/server/api/problem";
import { parseJsonBody, resolveRequestId } from "@/server/api/request";
import { mapServiceRequestRpcError } from "@/server/api/service-request-errors";
import { toActionResult } from "@/server/api/service-request-result";
import {
  apiJsonResponse,
  apiProblemResponse,
  authenticationRequiredProblem,
  internalApiProblem,
} from "@/server/supabase/http";
import { createSupabaseServerClient } from "@/server/supabase/server";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ orgId: string; id: string }>;
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const requestId = resolveRequestId(request.headers.get("x-request-id"));

  try {
    verifyCsrf(request, configuredAppOrigin(request));
    const expectedLockVersion = parseIfMatch(request.headers.get("if-match"));

    const { orgId: rawOrgId, id: rawId } = await context.params;
    const parsedOrgId = z.uuid().safeParse(rawOrgId);
    const parsedId = z.uuid().safeParse(rawId);
    if (!parsedOrgId.success) throw ApiProblem.fromZod(parsedOrgId.error);
    if (!parsedId.success) throw ApiProblem.fromZod(parsedId.error);

    const body = await parseJsonBody(request, triageRequestSchema);

    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) throw authenticationRequiredProblem();

    const { data, error } = await supabase.rpc("triage_service_request", {
      target_org: parsedOrgId.data,
      target_request: parsedId.data,
      expected_lock_version: expectedLockVersion,
      p_customer_id: body.customerId,
      p_location_id: body.locationId ?? null,
      p_asset_id: body.assetId ?? null,
      p_assigned_member_id: body.assignedMemberId ?? null,
      p_priority: body.priority ?? null,
      p_category: body.category ?? null,
      p_internal_note: body.internalNote ?? null,
    });
    if (error) throw mapServiceRequestRpcError(error);

    const result = toActionResult(data);
    if (!result) throw internalApiProblem();

    return apiJsonResponse({ data: result }, { requestId });
  } catch (error) {
    const safeError = error instanceof ApiProblem ? error : internalApiProblem();
    return apiProblemResponse(safeError, request, requestId);
  }
}
