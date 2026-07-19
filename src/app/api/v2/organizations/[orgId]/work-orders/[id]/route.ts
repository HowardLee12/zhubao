import { z } from "zod";

import { toClientWorkOrderDetail, workOrderDetailSchema } from "@/schemas/work-order-detail";
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

// GET detail is technician-safe: get_work_order_detail authorizes manager OR
// assigned technician, and strips internalNotes for non-managers. A missing or
// unauthorized work order collapses to a non-leaky 404.
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

    return apiJsonResponse(
      { data: toClientWorkOrderDetail(detail.data) },
      { requestId, headers: { etag: `"${detail.data.lockVersion}"` } },
    );
  } catch (error) {
    const safeError = error instanceof ApiProblem ? error : internalApiProblem();
    return apiProblemResponse(safeError, request, requestId);
  }
}
