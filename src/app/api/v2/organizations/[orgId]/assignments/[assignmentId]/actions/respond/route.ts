import { z } from "zod";

import { assignmentDtoSchema, assignmentRespondSchema } from "@/schemas/assignment";
import { configuredAppOrigin, verifyCsrf } from "@/server/api/csrf";
import { parseIfMatch } from "@/server/api/headers";
import { ApiProblem } from "@/server/api/problem";
import { parseJsonBody, resolveRequestId } from "@/server/api/request";
import { mapWorkOrderRpcError } from "@/server/api/work-order-errors";
import {
  apiJsonResponse,
  apiProblemResponse,
  authenticationRequiredProblem,
  internalApiProblem,
} from "@/server/supabase/http";
import { createSupabaseServerClient } from "@/server/supabase/server";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ orgId: string; assignmentId: string }>;
}

// Technician self accept/decline. transition_assignment enforces the self-only
// gate; decline requires a reason (enforced by the schema and the RPC).
export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const requestId = resolveRequestId(request.headers.get("x-request-id"));

  try {
    verifyCsrf(request, configuredAppOrigin(request));
    const expectedLockVersion = parseIfMatch(request.headers.get("if-match"));
    const idempotencyKey = request.headers.get("idempotency-key");

    const { orgId: rawOrgId, assignmentId: rawId } = await context.params;
    const parsedOrgId = z.uuid().safeParse(rawOrgId);
    const parsedId = z.uuid().safeParse(rawId);
    if (!parsedOrgId.success) throw ApiProblem.fromZod(parsedOrgId.error);
    if (!parsedId.success) throw ApiProblem.fromZod(parsedId.error);

    const body = await parseJsonBody(request, assignmentRespondSchema);

    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) throw authenticationRequiredProblem();

    const { data, error } = await supabase.rpc("respond_to_assignment", {
      target_org: parsedOrgId.data,
      target_assignment: parsedId.data,
      p_decision: body.decision,
      p_reason: body.decision === "decline" ? body.reason : null,
      p_expected_lock_version: expectedLockVersion,
      p_idempotency_key: idempotencyKey,
      p_request_id: requestId,
    });
    if (error) throw mapWorkOrderRpcError(error);

    const assignment = assignmentDtoSchema.safeParse(data);
    if (!assignment.success) throw internalApiProblem();
    return apiJsonResponse(
      { data: assignment.data },
      { requestId, headers: { etag: `"${assignment.data.lockVersion}"` } },
    );
  } catch (error) {
    const safeError = error instanceof ApiProblem ? error : internalApiProblem();
    return apiProblemResponse(safeError, request, requestId);
  }
}
