import { z } from "zod";

import { conversionEnvelopeSchema, convertRequestSchema } from "@/schemas/convert";
import { configuredAppOrigin, verifyCsrf } from "@/server/api/csrf";
import { parseIfMatch, requireStaffIdempotencyKey } from "@/server/api/headers";
import { ApiProblem } from "@/server/api/problem";
import { parseJsonBody, resolveRequestId } from "@/server/api/request";
import { mapServiceRequestRpcError } from "@/server/api/service-request-errors";
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

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const requestId = resolveRequestId(request.headers.get("x-request-id"));

  try {
    verifyCsrf(request, configuredAppOrigin(request));
    // Convert requires BOTH the optimistic lock AND an idempotency key: the
    // If-Match guards concurrent conversion, the key replays a retried request.
    const expectedLockVersion = parseIfMatch(request.headers.get("if-match"));
    const idempotencyKey = requireStaffIdempotencyKey(request.headers.get("idempotency-key"));

    const { orgId: rawOrgId, id: rawId } = await context.params;
    const parsedOrgId = z.uuid().safeParse(rawOrgId);
    const parsedId = z.uuid().safeParse(rawId);
    if (!parsedOrgId.success) throw ApiProblem.fromZod(parsedOrgId.error);
    if (!parsedId.success) throw ApiProblem.fromZod(parsedId.error);

    const body = await parseJsonBody(request, convertRequestSchema);

    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) throw authenticationRequiredProblem();

    const { data, error } = await supabase.rpc("convert_service_request", {
      target_org: parsedOrgId.data,
      target_request: parsedId.data,
      expected_lock_version: expectedLockVersion,
      p_mode: body.mode,
      p_project_title: body.projectTitle ?? null,
      p_work_order: body.workOrder ?? null,
      target_idempotency_key: idempotencyKey,
    });
    if (error) throw mapServiceRequestRpcError(error);

    const envelope = conversionEnvelopeSchema.safeParse(data);
    if (!envelope.success) throw internalApiProblem();

    return apiJsonResponse({ data: envelope.data }, { status: 201, requestId });
  } catch (error) {
    const safeError = error instanceof ApiProblem ? error : internalApiProblem();
    return apiProblemResponse(safeError, request, requestId);
  }
}
