import { z } from "zod";

import { createQuoteSchema, quoteWorkspaceSchema } from "@/schemas/quote";
import { configuredAppOrigin, verifyCsrf } from "@/server/api/csrf";
import { parseIfMatch, requireStaffIdempotencyKey } from "@/server/api/headers";
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
  params: Promise<{ orgId: string }>;
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const requestId = resolveRequestId(request.headers.get("x-request-id"));
  try {
    verifyCsrf(request, configuredAppOrigin(request));
    const expectedRequestLockVersion = parseIfMatch(request.headers.get("if-match"));
    const idempotencyKey = requireStaffIdempotencyKey(request.headers.get("idempotency-key"));
    const parsedOrgId = z.uuid().safeParse((await context.params).orgId);
    if (!parsedOrgId.success) throw ApiProblem.fromZod(parsedOrgId.error);

    const body = await parseJsonBody(request, createQuoteSchema);
    calculateValidatedQuoteDraft(body.version);

    const supabase = await createSupabaseServerClient();
    await authorizeOrgManager(supabase, parsedOrgId.data);
    const { data, error } = await supabase.rpc("create_pilot_quote", {
      p_organization_id: parsedOrgId.data,
      p_service_request_id: body.serviceRequestId,
      p_expected_request_lock_version: expectedRequestLockVersion,
      p_payload: {
        customerId: body.customerId,
        locationId: body.locationId,
        currency: body.currency,
        ...body.version,
      },
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
        headers: {
          location: `/api/v2/organizations/${parsedOrgId.data}/quotes/${workspace.data.quote.id}`,
          etag: `"${workspace.data.quote.lockVersion}"`,
        },
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
