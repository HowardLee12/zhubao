import { z } from "zod";

import { workOrderScheduleSchema } from "@/schemas/work-order-schedule";
import { toClientWorkOrderDetail, workOrderDetailSchema } from "@/schemas/work-order-detail";
import { configuredAppOrigin, verifyCsrf } from "@/server/api/csrf";
import { parseIfMatch } from "@/server/api/headers";
import { ApiProblem } from "@/server/api/problem";
import { parseJsonBody, resolveRequestId } from "@/server/api/request";
import {
  mapWorkOrderRpcError,
  WorkOrderScheduleConflict,
} from "@/server/api/work-order-errors";
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

    const body = await parseJsonBody(request, workOrderScheduleSchema);

    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) throw authenticationRequiredProblem();

    const { data, error } = await supabase.rpc("schedule_work_order", {
      target_org: parsedOrgId.data,
      target_work_order: parsedId.data,
      p_scheduled_start_at: body.scheduledStartAt,
      p_scheduled_end_at: body.scheduledEndAt,
      p_assignments: body.assignments,
      p_expected_lock_version: expectedLockVersion,
      p_occurred_at: body.occurredAt,
      p_conflict_override_reason: body.conflictOverrideReason ?? null,
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
    if (error instanceof WorkOrderScheduleConflict) {
      return scheduleConflictResponse(error, request, requestId);
    }
    const safeError = error instanceof ApiProblem ? error : internalApiProblem();
    return apiProblemResponse(safeError, request, requestId);
  }
}

function scheduleConflictResponse(
  problem: WorkOrderScheduleConflict,
  request: Request,
  requestId: string,
): Response {
  const body = {
    type: "https://renoly.app/problems/schedule-conflict",
    title: problem.title,
    status: problem.status,
    detail: problem.detail,
    code: problem.code,
    instance: new URL(request.url).pathname,
    requestId,
    conflicts: problem.conflicts,
  };
  return new Response(JSON.stringify(body), {
    status: problem.status,
    headers: {
      "cache-control": "private, no-store",
      pragma: "no-cache",
      "content-type": "application/problem+json; charset=utf-8",
      "x-request-id": requestId,
    },
  });
}
