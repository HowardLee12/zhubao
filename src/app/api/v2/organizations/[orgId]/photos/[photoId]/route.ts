import { z } from "zod";

import { photoUpdateSchema } from "@/schemas/work-order-photo";
import { configuredAppOrigin, verifyCsrf } from "@/server/api/csrf";
import { parseIfMatch } from "@/server/api/headers";
import { ApiProblem } from "@/server/api/problem";
import { parseJsonBody, resolveRequestId } from "@/server/api/request";
import { mapWorkOrderRpcError } from "@/server/api/work-order-errors";
import { resolveWorkOrderPhotoReadUrl } from "@/server/work-orders/gateway";
import {
  apiJsonResponse,
  apiProblemResponse,
  authenticationRequiredProblem,
  internalApiProblem,
} from "@/server/supabase/http";
import { createSupabaseServerClient } from "@/server/supabase/server";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ orgId: string; photoId: string }>;
}

async function parseIds(context: RouteContext): Promise<{ orgId: string; photoId: string }> {
  const { orgId: rawOrgId, photoId: rawId } = await context.params;
  const parsedOrgId = z.uuid().safeParse(rawOrgId);
  const parsedId = z.uuid().safeParse(rawId);
  if (!parsedOrgId.success) throw ApiProblem.fromZod(parsedOrgId.error);
  if (!parsedId.success) throw ApiProblem.fromZod(parsedId.error);
  return { orgId: parsedOrgId.data, photoId: parsedId.data };
}

async function requireUser(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
): Promise<void> {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) throw authenticationRequiredProblem();
}

const updateResultSchema = z
  .object({
    photoId: z.uuid(),
    caption: z.string().nullable(),
    category: z.string(),
    lockVersion: z.number().int(),
  })
  .strict();

const deleteResultSchema = z
  .object({ photoId: z.uuid(), status: z.literal("deleted") })
  .strict();

// GET a short-lived signed READ URL. The RPC authorizes (manager OR assigned) and
// returns the storage path; the Node signer mints the URL and never logs it.
export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const requestId = resolveRequestId(request.headers.get("x-request-id"));

  try {
    const { orgId, photoId } = await parseIds(context);
    const supabase = await createSupabaseServerClient();
    await requireUser(supabase);

    const result = await resolveWorkOrderPhotoReadUrl({
      supabase,
      organizationId: orgId,
      photoId,
    });
    return apiJsonResponse({ data: result }, { requestId });
  } catch (error) {
    const safeError = error instanceof ApiProblem ? error : internalApiProblem();
    return apiProblemResponse(safeError, request, requestId);
  }
}

// PATCH caption/category (uploader OR manager, If-Match on the photo).
export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  const requestId = resolveRequestId(request.headers.get("x-request-id"));

  try {
    verifyCsrf(request, configuredAppOrigin(request));
    const expectedLockVersion = parseIfMatch(request.headers.get("if-match"));
    const { orgId, photoId } = await parseIds(context);
    const body = await parseJsonBody(request, photoUpdateSchema);

    const supabase = await createSupabaseServerClient();
    await requireUser(supabase);

    const { data, error } = await supabase.rpc("update_work_order_photo", {
      target_org: orgId,
      target_photo: photoId,
      p_caption: body.caption ?? null,
      p_category: body.category ?? null,
      p_expected_lock_version: expectedLockVersion,
      p_request_id: requestId,
    });
    if (error) throw mapWorkOrderRpcError(error);

    const result = updateResultSchema.safeParse(data);
    if (!result.success) throw internalApiProblem();
    return apiJsonResponse(
      { data: result.data },
      { requestId, headers: { etag: `"${result.data.lockVersion}"` } },
    );
  } catch (error) {
    const safeError = error instanceof ApiProblem ? error : internalApiProblem();
    return apiProblemResponse(safeError, request, requestId);
  }
}

// DELETE = soft delete (uploader OR manager, If-Match on the photo). Refuses to
// delete the sole ready evidence photo of an evidence-required checklist item.
export async function DELETE(request: Request, context: RouteContext): Promise<Response> {
  const requestId = resolveRequestId(request.headers.get("x-request-id"));

  try {
    verifyCsrf(request, configuredAppOrigin(request));
    const expectedLockVersion = parseIfMatch(request.headers.get("if-match"));
    const { orgId, photoId } = await parseIds(context);

    const supabase = await createSupabaseServerClient();
    await requireUser(supabase);

    const { data, error } = await supabase.rpc("delete_work_order_photo", {
      target_org: orgId,
      target_photo: photoId,
      p_expected_lock_version: expectedLockVersion,
      p_request_id: requestId,
    });
    if (error) throw mapWorkOrderRpcError(error);

    const result = deleteResultSchema.safeParse(data);
    if (!result.success) throw internalApiProblem();
    return apiJsonResponse({ data: result.data }, { requestId });
  } catch (error) {
    const safeError = error instanceof ApiProblem ? error : internalApiProblem();
    return apiProblemResponse(safeError, request, requestId);
  }
}
