import { z } from "zod";

import {
  confirmIntakeDraftEnvelopeSchema,
  confirmIntakeDraftRequestSchema,
} from "@/schemas/intake-draft";
import { configuredAppOrigin, verifyCsrf } from "@/server/api/csrf";
import { parseIfMatch, requireStaffIdempotencyKey } from "@/server/api/headers";
import { mapIntakeDraftRpcError } from "@/server/api/intake-draft-errors";
import { ApiProblem } from "@/server/api/problem";
import { parseJsonBody, resolveRequestId } from "@/server/api/request";
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

// POST confirm: a human turns the AI/manual draft into a service_request (source=line).
// This is the human-in-the-loop gate — the DB never auto-converts. If-Match guards
// concurrent confirmation; the Idempotency-Key replays a retried confirm; the RPC's
// confirm-once (source_reference unique) makes a replay return the SAME service_request.
export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const requestId = resolveRequestId(request.headers.get("x-request-id"));

  try {
    verifyCsrf(request, configuredAppOrigin(request));
    const expectedLockVersion = parseIfMatch(request.headers.get("if-match"));
    const idempotencyKey = requireStaffIdempotencyKey(request.headers.get("idempotency-key"));

    const { orgId: rawOrgId, id: rawId } = await context.params;
    const parsedOrgId = z.uuid().safeParse(rawOrgId);
    const parsedId = z.uuid().safeParse(rawId);
    if (!parsedOrgId.success) throw ApiProblem.fromZod(parsedOrgId.error);
    if (!parsedId.success) throw ApiProblem.fromZod(parsedId.error);

    const body = await parseJsonBody(request, confirmIntakeDraftRequestSchema);

    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) throw authenticationRequiredProblem();

    const { data, error } = await supabase.rpc("confirm_intake_draft", {
      target_org: parsedOrgId.data,
      target_draft: parsedId.data,
      expected_lock_version: expectedLockVersion,
      target_idempotency_key: idempotencyKey,
      p_field_overrides: body.fieldOverrides ?? null,
    });
    if (error) throw mapIntakeDraftRpcError(error);

    const envelope = confirmIntakeDraftEnvelopeSchema.safeParse(data);
    if (!envelope.success) throw internalApiProblem();

    return apiJsonResponse(
      { data: envelope.data },
      { status: envelope.data.replayed ? 200 : 201, requestId },
    );
  } catch (error) {
    const safeError = error instanceof ApiProblem ? error : internalApiProblem();
    return apiProblemResponse(safeError, request, requestId);
  }
}
