import { z } from "zod";

import { workOrderDetailSchema } from "@/schemas/work-order-detail";
import { workOrderRouteTransitionSchema } from "@/schemas/work-order-transition";
import { configuredAppOrigin, verifyCsrf } from "@/server/api/csrf";
import { parseIfMatch } from "@/server/api/headers";
import { ApiProblem } from "@/server/api/problem";
import { parseJsonBody, resolveRequestId } from "@/server/api/request";
import { mapWorkOrderRpcError } from "@/server/api/work-order-errors";
import type { WorkOrderActorRole } from "@/server/domain/work-orders/work-order-state";
import {
  factsFromDetailDto,
  NOT_SENT_NOTIFICATION,
} from "@/server/work-orders/commands";
import { preCheckWorkOrderTransition, targetStatusFor } from "@/server/work-orders/gateway";
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

type WorkOrderDetail = z.infer<typeof workOrderDetailSchema>;

// Managers act as dispatcher for the domain pre-check; a technician who can read
// the detail (is_assigned) acts as an assigned technician. The DB re-checks the
// real role authoritatively, so this coarse mapping only powers the fast reject.
function actorFromDetail(detail: WorkOrderDetail): {
  role: WorkOrderActorRole;
  isAssigned: boolean;
} {
  const isManagerView = detail.internalNotes !== null;
  return {
    role: isManagerView ? "dispatcher" : "technician",
    isAssigned: detail.assignments.length > 0,
  };
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

    const body = await parseJsonBody(request, workOrderRouteTransitionSchema);

    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) throw authenticationRequiredProblem();

    // Fast pre-check: read the detail the caller is authorized to see, build the
    // domain facts and reject with a specific error BEFORE the write. The DB
    // transition is still the authoritative gate.
    const detailResult = await supabase.rpc("get_work_order_detail", {
      target_org: parsedOrgId.data,
      target_work_order: parsedId.data,
    });
    if (detailResult.error) throw mapWorkOrderRpcError(detailResult.error);
    const detail = workOrderDetailSchema.safeParse(detailResult.data);
    if (!detail.success) throw internalApiProblem();

    const actor = actorFromDetail(detail.data);
    const facts = factsFromDetailDto(detail.data);
    if (body.action === "cancel" || body.action === "reopen") {
      facts.reason = body.reason;
    }
    if (body.action === "complete") {
      facts.completionSummary = body.completionSummary;
    }
    if (body.overrideReason) {
      facts.overrideReason = body.overrideReason;
    }

    const preCheck = preCheckWorkOrderTransition({
      status: detail.data.status as never,
      action: body.action,
      role: actor.role,
      isAssigned: actor.isAssigned,
      now: new Date().toISOString(),
      occurredAt: body.occurredAt,
      facts,
    });
    if (preCheck) throw preCheck;

    const targetStatus = targetStatusFor(body.action);
    const reason =
      body.action === "cancel" || body.action === "reopen" ? body.reason : null;
    const completionSummary = body.action === "complete" ? body.completionSummary : null;

    const { data, error } = await supabase.rpc("transition_work_order_safe", {
      target_org: parsedOrgId.data,
      target_work_order: parsedId.data,
      target_status: targetStatus,
      expected_lock_version: expectedLockVersion,
      target_occurred_at: body.occurredAt,
      reason,
      completion_summary: completionSummary,
      target_correction_reason: body.overrideReason ?? null,
      target_request_id: requestId,
      target_idempotency_key: idempotencyKey,
    });
    if (error) throw mapWorkOrderRpcError(error);
    if (!data || typeof data !== "object") throw internalApiProblem();

    const dto = data as { lockVersion?: number };
    return apiJsonResponse(
      { data, notification: NOT_SENT_NOTIFICATION },
      {
        requestId,
        headers:
          typeof dto.lockVersion === "number" ? { etag: `"${dto.lockVersion}"` } : undefined,
      },
    );
  } catch (error) {
    const safeError = error instanceof ApiProblem ? error : internalApiProblem();
    return apiProblemResponse(safeError, request, requestId);
  }
}
