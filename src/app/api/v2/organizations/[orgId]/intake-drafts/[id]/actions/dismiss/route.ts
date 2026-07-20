import { z } from "zod";

import {
  dismissIntakeDraftEnvelopeSchema,
  dismissIntakeDraftRequestSchema,
} from "@/schemas/intake-draft";
import { configuredAppOrigin, verifyCsrf } from "@/server/api/csrf";
import { parseIfMatch } from "@/server/api/headers";
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

// POST dismiss: a human drops a spam / unparseable draft. If-Match guards concurrent
// mutation; dismiss is idempotent (a second dismiss returns replayed). owner/admin/
// dispatcher gate is enforced inside the RPC via has_org_role.
export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const requestId = resolveRequestId(request.headers.get("x-request-id"));

  try {
    verifyCsrf(request, configuredAppOrigin(request));
    const expectedLockVersion = parseIfMatch(request.headers.get("if-match"));

    const { orgId: rawOrgId, id: rawId } = await context.params;
    const parsedOrgId = z.uuid().safeParse(rawOrgId);
    const parsedId = z.uuid().safeParse(rawId);
    if (!parsedOrgId.success) throw ApiProblem.fromZod(parsedOrgId.error);
    if (!parsedId.success) throw ApiProblem.fromZod(parsedId.error);

    const body = await parseJsonBody(request, dismissIntakeDraftRequestSchema);

    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) throw authenticationRequiredProblem();

    const { data, error } = await supabase.rpc("dismiss_intake_draft", {
      target_org: parsedOrgId.data,
      target_draft: parsedId.data,
      expected_lock_version: expectedLockVersion,
      p_reason: body.reason ?? null,
    });
    if (error) throw mapIntakeDraftRpcError(error);

    const envelope = dismissIntakeDraftEnvelopeSchema.safeParse(data);
    if (!envelope.success) throw internalApiProblem();

    return apiJsonResponse({ data: envelope.data }, { requestId });
  } catch (error) {
    const safeError = error instanceof ApiProblem ? error : internalApiProblem();
    return apiProblemResponse(safeError, request, requestId);
  }
}
