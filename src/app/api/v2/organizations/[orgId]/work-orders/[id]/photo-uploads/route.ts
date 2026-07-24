import { z } from "zod";

import { photoUploadCreateSchema } from "@/schemas/work-order-photo";
import { configuredAppOrigin, verifyCsrf } from "@/server/api/csrf";
import { ApiProblem } from "@/server/api/problem";
import { parseJsonBody, resolveRequestId } from "@/server/api/request";
import { mapWorkOrderRpcError } from "@/server/api/work-order-errors";
import { signWorkMediaUploadUrl } from "@/server/api/work-order-photos";
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

const reservationSchema = z
  .object({
    photoId: z.uuid(),
    storagePath: z.string().min(1),
    status: z.literal("pending"),
    uploadExpiresInSeconds: z.number().int(),
  })
  .strict();

// Reserve a pending work-media photo row and mint a signed PUT URL. The RPC
// authorizes the caller (manager or assigned technician) and enforces the work
// order is in an uploadable state; the signed URL is minted with the admin signer.
export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const requestId = resolveRequestId(request.headers.get("x-request-id"));

  try {
    verifyCsrf(request, configuredAppOrigin(request));

    const { orgId: rawOrgId, id: rawId } = await context.params;
    const parsedOrgId = z.uuid().safeParse(rawOrgId);
    const parsedId = z.uuid().safeParse(rawId);
    if (!parsedOrgId.success) throw ApiProblem.fromZod(parsedOrgId.error);
    if (!parsedId.success) throw ApiProblem.fromZod(parsedId.error);

    const body = await parseJsonBody(request, photoUploadCreateSchema);

    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) throw authenticationRequiredProblem();

    const { data, error } = await supabase.rpc("create_photo_upload", {
      target_org: parsedOrgId.data,
      parent_type: "work_order",
      parent_id: parsedId.data,
      photo_category: body.category,
      original_filename: body.filename,
      declared_mime_type: body.contentType,
      declared_byte_size: body.byteSize,
      declared_sha256: body.sha256,
      target_checklist_item_id: body.checklistItemId ?? null,
      target_caption: body.caption ?? null,
      target_captured_at: body.capturedAt ?? null,
    });
    if (error) throw mapWorkOrderRpcError(error);

    const reservation = reservationSchema.safeParse(data);
    if (!reservation.success) throw internalApiProblem();

    const upload = await signWorkMediaUploadUrl(reservation.data.storagePath);

    return apiJsonResponse(
      { data: { photoId: reservation.data.photoId, upload } },
      { status: 201, requestId },
    );
  } catch (error) {
    const safeError = error instanceof ApiProblem ? error : internalApiProblem();
    return apiProblemResponse(safeError, request, requestId);
  }
}
