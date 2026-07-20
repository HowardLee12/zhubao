import type { SupabaseClient } from "@supabase/supabase-js";

import { dateWindowQuerySchema } from "@/schemas/dashboard";
import { authenticateAndRateLimit, parseUuidParam } from "@/server/api/operations-route";
import { ApiProblem } from "@/server/api/problem";
import { resolveRequestId } from "@/server/api/request";
import { apiJsonResponse, apiProblemResponse, internalApiProblem } from "@/server/supabase/http";
import { createSupabaseServerClient } from "@/server/supabase/server";

interface RouteContext {
  params: Promise<{ orgId: string }>;
}

// Shared GET handler for the /reports/{funnel,operations,retention} endpoints. Each
// report is rate-limited under the stricter search_report budget (30/min). The RPC
// redacts amount fields for roles without cost visibility.
export function makeReportRoute(
  report: (args: {
    supabase: Pick<SupabaseClient, "auth" | "rpc">;
    organizationId: string;
    from?: string;
    to?: string;
  }) => Promise<Record<string, unknown>>,
) {
  return async function GET(request: Request, context: RouteContext): Promise<Response> {
    const requestId = resolveRequestId(request.headers.get("x-request-id"));
    try {
      const organizationId = parseUuidParam((await context.params).orgId);
      const url = new URL(request.url);
      const query = dateWindowQuerySchema.safeParse({
        from: url.searchParams.get("from") ?? undefined,
        to: url.searchParams.get("to") ?? undefined,
      });
      if (!query.success) throw ApiProblem.fromZod(query.error);

      const supabase = await createSupabaseServerClient();
      await authenticateAndRateLimit(supabase, organizationId, "search_report");

      const data = await report({
        supabase,
        organizationId,
        from: query.data.from,
        to: query.data.to,
      });
      return apiJsonResponse({ data }, { requestId });
    } catch (error) {
      const safeError = error instanceof ApiProblem ? error : internalApiProblem();
      return apiProblemResponse(safeError, request, requestId);
    }
  };
}
