import { z } from "zod";

import {
  assignmentCancelSchema,
  assignmentDtoSchema,
  assignmentUpdateSchema,
} from "@/schemas/assignment";
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

async function parseIds(context: RouteContext): Promise<{ orgId: string; assignmentId: string }> {
  const { orgId: rawOrgId, assignmentId: rawId } = await context.params;
  const parsedOrgId = z.uuid().safeParse(rawOrgId);
  const parsedId = z.uuid().safeParse(rawId);
  if (!parsedOrgId.success) throw ApiProblem.fromZod(parsedOrgId.error);
  if (!parsedId.success) throw ApiProblem.fromZod(parsedId.error);
  return { orgId: parsedOrgId.data, assignmentId: parsedId.data };
}

// PATCH: change duty (manager only, If-Match on the assignment).
export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  const requestId = resolveRequestId(request.headers.get("x-request-id"));

  try {
    verifyCsrf(request, configuredAppOrigin(request));
    const expectedLockVersion = parseIfMatch(request.headers.get("if-match"));
    const { orgId, assignmentId } = await parseIds(context);
    const body = await parseJsonBody(request, assignmentUpdateSchema);

    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) throw authenticationRequiredProblem();

    const { data, error } = await supabase.rpc("update_assignment", {
      target_org: orgId,
      target_assignment: assignmentId,
      p_duty: body.duty,
      p_expected_lock_version: expectedLockVersion,
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

// DELETE: soft-cancel (-> cancelled). Reason is mandatory and carried in the body.
export async function DELETE(request: Request, context: RouteContext): Promise<Response> {
  const requestId = resolveRequestId(request.headers.get("x-request-id"));

  try {
    verifyCsrf(request, configuredAppOrigin(request));
    const expectedLockVersion = parseIfMatch(request.headers.get("if-match"));
    const { orgId, assignmentId } = await parseIds(context);
    const body = await parseJsonBody(request, assignmentCancelSchema);

    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) throw authenticationRequiredProblem();

    const { data, error } = await supabase.rpc("cancel_assignment", {
      target_org: orgId,
      target_assignment: assignmentId,
      p_reason: body.reason,
      p_expected_lock_version: expectedLockVersion,
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
