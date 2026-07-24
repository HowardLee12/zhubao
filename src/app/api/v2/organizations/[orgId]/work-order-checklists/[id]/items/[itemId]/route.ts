import { z } from "zod";

import { checklistItemRespondSchema } from "@/schemas/work-order-checklist";
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
  params: Promise<{ orgId: string; id: string; itemId: string }>;
}

const respondedSchema = z
  .object({
    id: z.uuid(),
    workOrderId: z.uuid(),
    response: z.unknown(),
    completedAt: z.string(),
    lockVersion: z.number().int(),
  })
  .strict();

// PATCH a checklist item response. The If-Match header carries the PARENT work
// order lock version (the item shares the aggregate's optimistic lock). Manager
// or assigned technician; the RPC enforces on_site|paused and the role gate.
export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  const requestId = resolveRequestId(request.headers.get("x-request-id"));

  try {
    verifyCsrf(request, configuredAppOrigin(request));
    const expectedWorkOrderLockVersion = parseIfMatch(request.headers.get("if-match"));

    const { orgId: rawOrgId, itemId: rawItemId } = await context.params;
    const parsedOrgId = z.uuid().safeParse(rawOrgId);
    const parsedItemId = z.uuid().safeParse(rawItemId);
    if (!parsedOrgId.success) throw ApiProblem.fromZod(parsedOrgId.error);
    if (!parsedItemId.success) throw ApiProblem.fromZod(parsedItemId.error);

    const body = await parseJsonBody(request, checklistItemRespondSchema);

    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) throw authenticationRequiredProblem();

    const { data, error } = await supabase.rpc("respond_to_checklist_item", {
      target_org: parsedOrgId.data,
      target_item: parsedItemId.data,
      response_value: body.response,
      expected_work_order_lock_version: expectedWorkOrderLockVersion,
    });
    if (error) throw mapWorkOrderRpcError(error);

    const responded = respondedSchema.safeParse(data);
    if (!responded.success) throw internalApiProblem();

    return apiJsonResponse(
      { data: responded.data },
      { requestId, headers: { etag: `"${responded.data.lockVersion}"` } },
    );
  } catch (error) {
    const safeError = error instanceof ApiProblem ? error : internalApiProblem();
    return apiProblemResponse(safeError, request, requestId);
  }
}
