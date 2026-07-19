import { z } from "zod";

import {
  serviceRequestPatchSchema,
  serviceRequestWorkspaceRpcSchema,
  toServiceRequestDetail,
  type ServiceRequestDetail,
} from "@/schemas/service-request-detail";
import { configuredAppOrigin, verifyCsrf } from "@/server/api/csrf";
import { parseIfMatch } from "@/server/api/headers";
import { authorizeOrgManager } from "@/server/api/org-authorization";
import { ApiProblem } from "@/server/api/problem";
import { parseJsonBody, resolveRequestId } from "@/server/api/request";
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

async function resolveIds(context: RouteContext): Promise<{ orgId: string; id: string }> {
  const { orgId: rawOrgId, id: rawId } = await context.params;
  const parsedOrgId = z.uuid().safeParse(rawOrgId);
  const parsedId = z.uuid().safeParse(rawId);
  if (!parsedOrgId.success) throw ApiProblem.fromZod(parsedOrgId.error);
  if (!parsedId.success) throw ApiProblem.fromZod(parsedId.error);
  return { orgId: parsedOrgId.data, id: parsedId.data };
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const requestId = resolveRequestId(request.headers.get("x-request-id"));

  try {
    const { orgId, id } = await resolveIds(context);

    const supabase = await createSupabaseServerClient();
    await authorizeOrgManager(supabase, orgId);

    const { data, error } = await supabase.rpc("get_pilot_service_request_detail", {
      p_organization_id: orgId,
      p_service_request_id: id,
    });
    if (error) throw mapServiceRequestRpcError(error);

    const workspace = serviceRequestWorkspaceRpcSchema.safeParse(data);
    if (!workspace.success) throw internalApiProblem();
    const photos = await signServiceRequestPhotos(workspace.data.photos);

    const detail: ServiceRequestDetail = toServiceRequestDetail(
      workspace.data.request,
      workspace.data.windows,
      photos,
    );

    return apiJsonResponse(
      { data: detail },
      { requestId, headers: { etag: `"${detail.lockVersion}"` } },
    );
  } catch (error) {
    const safeError = error instanceof ApiProblem ? error : internalApiProblem();
    return apiProblemResponse(safeError, request, requestId);
  }
}

export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  const requestId = resolveRequestId(request.headers.get("x-request-id"));

  try {
    verifyCsrf(request, configuredAppOrigin(request));
    const expectedLockVersion = parseIfMatch(request.headers.get("if-match"));

    const { orgId, id } = await resolveIds(context);
    const body = await parseJsonBody(request, serviceRequestPatchSchema);

    const supabase = await createSupabaseServerClient();
    await authorizeOrgManager(supabase, orgId);

    // subject is canonical; title remains a deprecated HTTP alias only and is
    // never passed through as a database field.
    const { title, ...rpcPatch } = body;
    if (rpcPatch.subject === undefined && title !== undefined) {
      rpcPatch.subject = title;
    }

    const { data, error } = await supabase.rpc("update_pilot_service_request_summary", {
      p_organization_id: orgId,
      p_service_request_id: id,
      p_expected_lock_version: expectedLockVersion,
      p_patch: rpcPatch,
      p_request_id: requestId,
    });
    if (error) throw mapServiceRequestRpcError(error);

    const workspace = serviceRequestWorkspaceRpcSchema.safeParse(data);
    if (!workspace.success) throw internalApiProblem();
    const photos = await signServiceRequestPhotos(workspace.data.photos);

    const detail = toServiceRequestDetail(
      workspace.data.request,
      workspace.data.windows,
      photos,
    );
    return apiJsonResponse(
      { data: detail },
      { requestId, headers: { etag: `"${detail.lockVersion}"` } },
    );
  } catch (error) {
    const safeError = error instanceof ApiProblem ? error : internalApiProblem();
    return apiProblemResponse(safeError, request, requestId);
  }
}
