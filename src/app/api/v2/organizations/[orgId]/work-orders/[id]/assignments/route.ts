import { z } from "zod";

import { assignmentCreateSchema, assignmentDtoSchema } from "@/schemas/assignment";
import { workOrderDetailSchema } from "@/schemas/work-order-detail";
import { configuredAppOrigin, verifyCsrf } from "@/server/api/csrf";
import { requireStaffIdempotencyKey } from "@/server/api/headers";
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
  params: Promise<{ orgId: string; id: string }>;
}

// GET assignments: derived from the detail projection (which is manager-or-assigned
// authorized in the RPC). No separate list RPC exists; the roster lives on detail.
export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const requestId = resolveRequestId(request.headers.get("x-request-id"));

  try {
    const { orgId: rawOrgId, id: rawId } = await context.params;
    const parsedOrgId = z.uuid().safeParse(rawOrgId);
    const parsedId = z.uuid().safeParse(rawId);
    if (!parsedOrgId.success) throw ApiProblem.fromZod(parsedOrgId.error);
    if (!parsedId.success) throw ApiProblem.fromZod(parsedId.error);

    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) throw authenticationRequiredProblem();

    const { data, error } = await supabase.rpc("get_work_order_detail", {
      target_org: parsedOrgId.data,
      target_work_order: parsedId.data,
    });
    if (error) throw mapWorkOrderRpcError(error);
    const detail = workOrderDetailSchema.safeParse(data);
    if (!detail.success) throw internalApiProblem();

    return apiJsonResponse({ data: detail.data.assignments }, { requestId });
  } catch (error) {
    const safeError = error instanceof ApiProblem ? error : internalApiProblem();
    return apiProblemResponse(safeError, request, requestId);
  }
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const requestId = resolveRequestId(request.headers.get("x-request-id"));

  try {
    verifyCsrf(request, configuredAppOrigin(request));
    const idempotencyKey = requireStaffIdempotencyKey(request.headers.get("idempotency-key"));

    const { orgId: rawOrgId, id: rawId } = await context.params;
    const parsedOrgId = z.uuid().safeParse(rawOrgId);
    const parsedId = z.uuid().safeParse(rawId);
    if (!parsedOrgId.success) throw ApiProblem.fromZod(parsedOrgId.error);
    if (!parsedId.success) throw ApiProblem.fromZod(parsedId.error);

    const body = await parseJsonBody(request, assignmentCreateSchema);

    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) throw authenticationRequiredProblem();

    const { data, error } = await supabase.rpc("create_assignment", {
      target_org: parsedOrgId.data,
      target_work_order: parsedId.data,
      p_membership_id: body.membershipId,
      p_duty: body.duty,
      p_idempotency_key: idempotencyKey,
      p_request_id: requestId,
    });
    if (error) throw mapWorkOrderRpcError(error);

    const assignment = assignmentDtoSchema.safeParse(data);
    if (!assignment.success) throw internalApiProblem();

    const replayed = assignment.data.replayed === true;
    return apiJsonResponse(
      { data: assignment.data },
      {
        status: replayed ? 200 : 201,
        requestId,
        headers: { etag: `"${assignment.data.lockVersion}"` },
      },
    );
  } catch (error) {
    const safeError = error instanceof ApiProblem ? error : internalApiProblem();
    return apiProblemResponse(safeError, request, requestId);
  }
}
