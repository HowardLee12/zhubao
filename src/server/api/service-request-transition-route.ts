import { z } from "zod";

import { serviceRequestCloseSchema } from "@/schemas/service-request-close";
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

type TransitionStatus = "quoting" | "quoted" | "declined" | "cancelled";

interface RouteContext {
  params: Promise<{ orgId: string; id: string }>;
}

// Factory for the status-only transition actions (start-quoting/mark-quoted/
// decline/cancel). They share the same auth + CSRF + If-Match preamble and call
// transition_service_request; decline/cancel additionally require a reason body.
export function createTransitionRoute(targetStatus: TransitionStatus) {
  const requiresReason = targetStatus === "declined" || targetStatus === "cancelled";

  return async function POST(
    request: Request,
    context: RouteContext,
  ): Promise<Response> {
    const requestId = resolveRequestId(request.headers.get("x-request-id"));

    try {
      verifyCsrf(request, configuredAppOrigin(request));
      const expectedLockVersion = parseIfMatch(request.headers.get("if-match"));

      const { orgId: rawOrgId, id: rawId } = await context.params;
      const parsedOrgId = z.uuid().safeParse(rawOrgId);
      const parsedId = z.uuid().safeParse(rawId);
      if (!parsedOrgId.success) throw ApiProblem.fromZod(parsedOrgId.error);
      if (!parsedId.success) throw ApiProblem.fromZod(parsedId.error);

      let reason: string | null = null;
      if (requiresReason) {
        const body = await parseJsonBody(request, serviceRequestCloseSchema);
        reason = body.reason;
      }

      const supabase = await createSupabaseServerClient();
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();
      if (userError || !user) throw authenticationRequiredProblem();

      const { data, error } = await supabase.rpc("transition_service_request", {
        target_org: parsedOrgId.data,
        target_request: parsedId.data,
        target_status: targetStatus,
        expected_lock_version: expectedLockVersion,
        reason,
      });
      if (error) throw mapServiceRequestRpcError(error);

      const result = toActionResult(data);
      if (!result) throw internalApiProblem();

      return apiJsonResponse({ data: result }, { requestId });
    } catch (error) {
      const safeError = error instanceof ApiProblem ? error : internalApiProblem();
      return apiProblemResponse(safeError, request, requestId);
    }
  };
}
