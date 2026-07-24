import { z } from "zod";

import { quoteWorkspaceSchema } from "@/schemas/quote";
import { configuredAppOrigin, verifyCsrf } from "@/server/api/csrf";
import { parseIfMatch, requireStaffIdempotencyKey } from "@/server/api/headers";
import { authorizeOrgManager } from "@/server/api/org-authorization";
import { ApiProblem } from "@/server/api/problem";
import { mapQuoteRpcError } from "@/server/api/quote-errors";
import { resolveRequestId } from "@/server/api/request";
import {
  apiJsonResponse,
  apiProblemResponse,
  internalApiProblem,
} from "@/server/supabase/http";
import { createIdempotentPublicCapabilityToken } from "@/server/supabase/public-token";
import { createSupabaseServerClient } from "@/server/supabase/server";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ orgId: string; id: string }>;
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const requestId = resolveRequestId(request.headers.get("x-request-id"));
  try {
    const appOrigin = configuredAppOrigin(request);
    verifyCsrf(request, appOrigin);
    const expectedQuoteLockVersion = parseIfMatch(request.headers.get("if-match"));
    const idempotencyKey = requireStaffIdempotencyKey(request.headers.get("idempotency-key"));
    const ids = z.object({ orgId: z.uuid(), id: z.uuid() }).safeParse(await context.params);
    if (!ids.success) throw ApiProblem.fromZod(ids.error);
    const token = createIdempotentPublicCapabilityToken({
      operation: "quote-rotate",
      organizationId: ids.data.orgId,
      resourceId: ids.data.id,
      idempotencyKey,
    });

    const supabase = await createSupabaseServerClient();
    await authorizeOrgManager(supabase, ids.data.orgId);
    const { data, error } = await supabase.rpc("rotate_pilot_quote_public_token", {
      p_organization_id: ids.data.orgId,
      p_quote_id: ids.data.id,
      p_expected_quote_lock_version: expectedQuoteLockVersion,
      p_public_token_hash_hex: token.hashHex,
      p_idempotency_key: idempotencyKey,
      p_request_id: requestId,
    });
    if (error) throw mapQuoteRpcError(error);
    const workspace = quoteWorkspaceSchema.safeParse(data);
    if (!workspace.success) throw internalApiProblem();
    const publicQuoteUrl = new URL("/public/quotes", appOrigin);
    publicQuoteUrl.hash = token.rawToken;
    return apiJsonResponse(
      {
        data: {
          ...workspace.data,
          publicQuoteUrl: publicQuoteUrl.toString(),
        },
      },
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
