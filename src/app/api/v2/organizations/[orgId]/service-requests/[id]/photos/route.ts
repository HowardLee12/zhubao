import { z } from "zod";

import { serviceRequestWorkspaceRpcSchema } from "@/schemas/service-request-detail";
import { authorizeOrgManager } from "@/server/api/org-authorization";
import { ApiProblem } from "@/server/api/problem";
import { resolveRequestId } from "@/server/api/request";
import { mapServiceRequestRpcError } from "@/server/api/service-request-errors";
import { signServiceRequestPhotos } from "@/server/api/service-request-photos";
import {
  apiJsonResponse,
  apiProblemResponse,
  internalApiProblem,
} from "@/server/supabase/http";
import { createSupabaseServerClient } from "@/server/supabase/server";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ orgId: string; id: string }>;
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const requestId = resolveRequestId(request.headers.get("x-request-id"));

  try {
    const { orgId: rawOrgId, id: rawId } = await context.params;
    const parsedOrgId = z.uuid().safeParse(rawOrgId);
    const parsedId = z.uuid().safeParse(rawId);
    if (!parsedOrgId.success) throw ApiProblem.fromZod(parsedOrgId.error);
    if (!parsedId.success) throw ApiProblem.fromZod(parsedId.error);

    const supabase = await createSupabaseServerClient();
    await authorizeOrgManager(supabase, parsedOrgId.data);

    const { data, error } = await supabase.rpc("get_pilot_service_request_detail", {
      p_organization_id: parsedOrgId.data,
      p_service_request_id: parsedId.data,
    });
    if (error) throw mapServiceRequestRpcError(error);
    const workspace = serviceRequestWorkspaceRpcSchema.safeParse(data);
    if (!workspace.success) throw internalApiProblem();
    const photos = await signServiceRequestPhotos(workspace.data.photos);

    return apiJsonResponse({ data: photos }, { requestId });
  } catch (error) {
    const safeError = error instanceof ApiProblem ? error : internalApiProblem();
    return apiProblemResponse(safeError, request, requestId);
  }
}
