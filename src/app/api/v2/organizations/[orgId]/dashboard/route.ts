import { dateWindowQuerySchema } from "@/schemas/dashboard";
import { authenticateAndRateLimit, parseUuidParam } from "@/server/api/operations-route";
import { ApiProblem } from "@/server/api/problem";
import { resolveRequestId } from "@/server/api/request";
import { computeDashboard } from "@/server/reporting/gateway";
import { apiJsonResponse, apiProblemResponse, internalApiProblem } from "@/server/supabase/http";
import { createSupabaseServerClient } from "@/server/supabase/server";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ orgId: string }>;
}

// Four fixed KPIs, each with numerator/denominator/window/timezone so the UI can
// show an honest "尚無足夠資料" instead of a misleading 0%. Technicians never reach
// this route (RPC role gate excludes them); no cost is emitted.
export async function GET(request: Request, context: RouteContext): Promise<Response> {
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
    await authenticateAndRateLimit(supabase, organizationId, "read");

    const data = await computeDashboard({
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
}
