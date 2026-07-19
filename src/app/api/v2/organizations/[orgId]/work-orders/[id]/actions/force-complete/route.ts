import { z } from "zod";

import { forceCompleteSchema } from "@/schemas/force-complete";
import { toClientWorkOrderDetail, workOrderDetailSchema } from "@/schemas/work-order-detail";
import { configuredAppOrigin, verifyCsrf } from "@/server/api/csrf";
import { parseIfMatch } from "@/server/api/headers";
import { ApiProblem } from "@/server/api/problem";
import { parseJsonBody, resolveRequestId } from "@/server/api/request";
import { mapWorkOrderRpcError } from "@/server/api/work-order-errors";
import { NOT_SENT_NOTIFICATION } from "@/server/work-orders/commands";
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

// Owner/admin exception completion. The RPC re-enforces the owner gate, records a
// distinct work_order.force_completed audit event and NEVER sets a customer
// sign-off. This is explicitly not a customer confirmation.
export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const requestId = resolveRequestId(request.headers.get("x-request-id"));

  try {
    verifyCsrf(request, configuredAppOrigin(request));
    const expectedLockVersion = parseIfMatch(request.headers.get("if-match"));
    const idempotencyKey = request.headers.get("idempotency-key");

    const { orgId: rawOrgId, id: rawId } = await context.params;
    const parsedOrgId = z.uuid().safeParse(rawOrgId);
    const parsedId = z.uuid().safeParse(rawId);
    if (!parsedOrgId.success) throw ApiProblem.fromZod(parsedOrgId.error);
    if (!parsedId.success) throw ApiProblem.fromZod(parsedId.error);

    const body = await parseJsonBody(request, forceCompleteSchema);

    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) throw authenticationRequiredProblem();

    const { data, error } = await supabase.rpc("force_complete_work_order", {
      target_org: parsedOrgId.data,
      target_work_order: parsedId.data,
      p_reason: body.reason,
      p_completion_summary: body.completionSummary,
      p_expected_lock_version: expectedLockVersion,
      p_occurred_at: body.occurredAt,
      p_idempotency_key: idempotencyKey,
      p_request_id: requestId,
    });
    if (error) throw mapWorkOrderRpcError(error);

    const detail = workOrderDetailSchema.safeParse(data);
    if (!detail.success) throw internalApiProblem();

    return apiJsonResponse(
      {
        data: toClientWorkOrderDetail(detail.data),
        notification: NOT_SENT_NOTIFICATION,
      },
      { requestId, headers: { etag: `"${detail.data.lockVersion}"` } },
    );
  } catch (error) {
    const safeError = error instanceof ApiProblem ? error : internalApiProblem();
    return apiProblemResponse(safeError, request, requestId);
  }
}
