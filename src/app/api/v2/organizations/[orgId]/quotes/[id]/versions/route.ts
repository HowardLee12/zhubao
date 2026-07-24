import { z } from "zod";

import { cloneQuoteVersionSchema, quoteWorkspaceSchema } from "@/schemas/quote";
import { configuredAppOrigin, verifyCsrf } from "@/server/api/csrf";
import { parseIfMatch, requireStaffIdempotencyKey } from "@/server/api/headers";
import { authorizeOrgManager } from "@/server/api/org-authorization";
import { ApiProblem } from "@/server/api/problem";
import { mapQuoteRpcError } from "@/server/api/quote-errors";
import { parseJsonBody, resolveRequestId } from "@/server/api/request";
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

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const requestId = resolveRequestId(request.headers.get("x-request-id"));
  try {
    verifyCsrf(request, configuredAppOrigin(request));
    const expectedQuoteLockVersion = parseIfMatch(request.headers.get("if-match"));
    const idempotencyKey = requireStaffIdempotencyKey(request.headers.get("idempotency-key"));
    const ids = z.object({ orgId: z.uuid(), id: z.uuid() }).safeParse(await context.params);
    if (!ids.success) throw ApiProblem.fromZod(ids.error);
    const body = await parseJsonBody(request, cloneQuoteVersionSchema);

    const supabase = await createSupabaseServerClient();
    await authorizeOrgManager(supabase, ids.data.orgId);
    const { data, error } = await supabase.rpc("clone_pilot_quote_version", {
      p_organization_id: ids.data.orgId,
      p_quote_id: ids.data.id,
      p_clone_from_version_id: body.cloneFromVersionId,
      p_expected_quote_lock_version: expectedQuoteLockVersion,
      p_idempotency_key: idempotencyKey,
      p_request_id: requestId,
    });
    if (error) throw mapQuoteRpcError(error);
    const workspace = quoteWorkspaceSchema.safeParse(data);
    if (!workspace.success) throw internalApiProblem();

    return apiJsonResponse(
      { data: workspace.data },
      {
        status: 201,
        requestId,
        headers: { etag: `"${workspace.data.quote.lockVersion}"` },
      },
    );
  } catch (error) {
    return apiProblemResponse(
      error instanceof ApiProblem ? error : internalApiProblem(),
      request,
      requestId,
    );
  }
}
