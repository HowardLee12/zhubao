import { z } from "zod";

import {
  locationRowSchema,
  toLocationDto,
} from "@/schemas/location";
import { authorizeOrgManager } from "@/server/api/org-authorization";
import { ApiProblem } from "@/server/api/problem";
import { resolveRequestId } from "@/server/api/request";
import { mapServiceRequestRpcError } from "@/server/api/service-request-errors";
import {
  apiJsonResponse,
  apiProblemResponse,
  internalApiProblem,
} from "@/server/supabase/http";
import { createSupabaseServerClient } from "@/server/supabase/server";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ orgId: string; customerId: string }>;
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const requestId = resolveRequestId(request.headers.get("x-request-id"));

  try {
    const { orgId: rawOrgId, customerId: rawCustomerId } = await context.params;
    const parsedOrgId = z.uuid().safeParse(rawOrgId);
    const parsedCustomerId = z.uuid().safeParse(rawCustomerId);
    if (!parsedOrgId.success) throw ApiProblem.fromZod(parsedOrgId.error);
    if (!parsedCustomerId.success) throw ApiProblem.fromZod(parsedCustomerId.error);

    const supabase = await createSupabaseServerClient();
    await authorizeOrgManager(supabase, parsedOrgId.data);

    const { data, error } = await supabase.rpc("list_pilot_customer_locations", {
      p_organization_id: parsedOrgId.data,
      p_customer_id: parsedCustomerId.data,
    });
    if (error) throw mapServiceRequestRpcError(error);

    const rows = z.array(locationRowSchema).safeParse(data ?? []);
    if (!rows.success) throw internalApiProblem();

    return apiJsonResponse({ data: rows.data.map((row) => toLocationDto(row)) }, { requestId });
  } catch (error) {
    const safeError = error instanceof ApiProblem ? error : internalApiProblem();
    return apiProblemResponse(safeError, request, requestId);
  }
}
