import { z } from "zod";

import { checklistCreateSchema } from "@/schemas/work-order-checklist";
import { workOrderDetailSchema } from "@/schemas/work-order-detail";
import { configuredAppOrigin, verifyCsrf } from "@/server/api/csrf";
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

const checklistCreatedSchema = z
  .object({ checklistId: z.uuid(), workOrderId: z.uuid(), name: z.string() })
  .strict();

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

    return apiJsonResponse({ data: detail.data.checklists }, { requestId });
  } catch (error) {
    const safeError = error instanceof ApiProblem ? error : internalApiProblem();
    return apiProblemResponse(safeError, request, requestId);
  }
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const requestId = resolveRequestId(request.headers.get("x-request-id"));

  try {
    verifyCsrf(request, configuredAppOrigin(request));

    const { orgId: rawOrgId, id: rawId } = await context.params;
    const parsedOrgId = z.uuid().safeParse(rawOrgId);
    const parsedId = z.uuid().safeParse(rawId);
    if (!parsedOrgId.success) throw ApiProblem.fromZod(parsedOrgId.error);
    if (!parsedId.success) throw ApiProblem.fromZod(parsedId.error);

    const body = await parseJsonBody(request, checklistCreateSchema);

    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) throw authenticationRequiredProblem();

    const { data, error } = await supabase.rpc("create_work_order_checklist", {
      target_org: parsedOrgId.data,
      target_work_order: parsedId.data,
      p_name: body.name,
      p_items: body.items,
      p_request_id: requestId,
    });
    if (error) throw mapWorkOrderRpcError(error);

    const created = checklistCreatedSchema.safeParse(data);
    if (!created.success) throw internalApiProblem();

    return apiJsonResponse({ data: created.data }, { status: 201, requestId });
  } catch (error) {
    const safeError = error instanceof ApiProblem ? error : internalApiProblem();
    return apiProblemResponse(safeError, request, requestId);
  }
}
