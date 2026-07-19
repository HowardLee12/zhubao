import { z } from "zod";

import { configuredAppOrigin, verifyCsrf } from "@/server/api/csrf";
import { parseIfMatch } from "@/server/api/headers";
import { ApiProblem } from "@/server/api/problem";
import { resolveRequestId } from "@/server/api/request";
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

const completedSchema = z
  .object({
    checklistId: z.uuid(),
    workOrderId: z.uuid(),
    status: z.literal("completed"),
    completedAt: z.string(),
  })
  .strict();

// Complete one checklist. If-Match carries the PARENT work-order lock version. The
// RPC verifies every required item answered and every evidence-required item has a
// ready photo before flipping the checklist to completed.
export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const requestId = resolveRequestId(request.headers.get("x-request-id"));

  try {
    verifyCsrf(request, configuredAppOrigin(request));
    const expectedWorkOrderLockVersion = parseIfMatch(request.headers.get("if-match"));

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

    const { data, error } = await supabase.rpc("complete_work_order_checklist", {
      target_org: parsedOrgId.data,
      target_checklist: parsedId.data,
      p_expected_work_order_lock_version: expectedWorkOrderLockVersion,
      p_request_id: requestId,
    });
    if (error) throw mapWorkOrderRpcError(error);

    const completed = completedSchema.safeParse(data);
    if (!completed.success) throw internalApiProblem();

    return apiJsonResponse({ data: completed.data }, { requestId });
  } catch (error) {
    const safeError = error instanceof ApiProblem ? error : internalApiProblem();
    return apiProblemResponse(safeError, request, requestId);
  }
}
