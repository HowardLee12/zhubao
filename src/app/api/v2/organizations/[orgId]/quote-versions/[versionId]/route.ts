import { z } from "zod";

import { quoteDraftSchema, quoteWorkspaceSchema } from "@/schemas/quote";
import { configuredAppOrigin, verifyCsrf } from "@/server/api/csrf";
import { parseIfMatch } from "@/server/api/headers";
import { authorizeOrgManager } from "@/server/api/org-authorization";
import { ApiProblem } from "@/server/api/problem";
import { mapQuoteRpcError } from "@/server/api/quote-errors";
import { parseJsonBody, resolveRequestId } from "@/server/api/request";
import { calculateValidatedQuoteDraft } from "@/server/quotes/commands";
import {
  apiJsonResponse,
  apiProblemResponse,
  internalApiProblem,
} from "@/server/supabase/http";
import { createSupabaseServerClient } from "@/server/supabase/server";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ orgId: string; versionId: string }>;
}

export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  const requestId = resolveRequestId(request.headers.get("x-request-id"));
  try {
    verifyCsrf(request, configuredAppOrigin(request));
    const expectedQuoteLockVersion = parseIfMatch(request.headers.get("if-match"));
    const params = await context.params;
    const ids = z.object({ orgId: z.uuid(), versionId: z.uuid() }).safeParse(params);
    if (!ids.success) throw ApiProblem.fromZod(ids.error);
    const body = await parseJsonBody(request, quoteDraftSchema);
    calculateValidatedQuoteDraft(body);

    const supabase = await createSupabaseServerClient();
    await authorizeOrgManager(supabase, ids.data.orgId);
    const { data, error } = await supabase.rpc("save_pilot_quote_draft", {
      p_organization_id: ids.data.orgId,
      p_version_id: ids.data.versionId,
      p_expected_quote_lock_version: expectedQuoteLockVersion,
      p_payload: body,
      p_request_id: requestId,
    });
    if (error) throw mapQuoteRpcError(error);
    const workspace = quoteWorkspaceSchema.safeParse(data);
    if (!workspace.success) throw internalApiProblem();

    return apiJsonResponse(
      { data: workspace.data },
      {
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
