import { z } from "zod";

import { quoteWorkspaceSchema } from "@/schemas/quote";
import { authorizeOrgManager } from "@/server/api/org-authorization";
import { ApiProblem } from "@/server/api/problem";
import { mapQuoteRpcError } from "@/server/api/quote-errors";
import { resolveRequestId } from "@/server/api/request";
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

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const requestId = resolveRequestId(request.headers.get("x-request-id"));
  try {
    const params = await context.params;
    const ids = z.object({ orgId: z.uuid(), id: z.uuid() }).safeParse(params);
    if (!ids.success) throw ApiProblem.fromZod(ids.error);

    const supabase = await createSupabaseServerClient();
    await authorizeOrgManager(supabase, ids.data.orgId);
    const { data, error } = await supabase.rpc("get_pilot_quote_workspace", {
      p_organization_id: ids.data.orgId,
      p_quote_id: ids.data.id,
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
