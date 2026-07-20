import { prepareMaintenanceRemindersSchema } from "@/schemas/maintenance-plan";
import { configuredAppOrigin, verifyCsrf } from "@/server/api/csrf";
import { authenticateAndRateLimit, parseUuidParam } from "@/server/api/operations-route";
import { ApiProblem } from "@/server/api/problem";
import { parseJsonBody, resolveRequestId } from "@/server/api/request";
import { prepareMaintenanceReminders } from "@/server/maintenance/gateway";
import { apiJsonResponse, apiProblemResponse, internalApiProblem } from "@/server/supabase/http";
import { createSupabaseServerClient } from "@/server/supabase/server";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ orgId: string }>;
}

// Draft-only: enqueues an approval-pending revisit reminder per plan (≤100). It
// never auto-sends — staff must approve via notifications:approve first.
export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const requestId = resolveRequestId(request.headers.get("x-request-id"));
  try {
    verifyCsrf(request, configuredAppOrigin(request));
    const organizationId = parseUuidParam((await context.params).orgId);
    const body = await parseJsonBody(request, prepareMaintenanceRemindersSchema);

    const supabase = await createSupabaseServerClient();
    await authenticateAndRateLimit(supabase, organizationId, "mutation");

    const data = await prepareMaintenanceReminders({
      supabase,
      organizationId,
      input: body,
      requestId,
    });
    return apiJsonResponse({ data }, { requestId });
  } catch (error) {
    const safeError = error instanceof ApiProblem ? error : internalApiProblem();
    return apiProblemResponse(safeError, request, requestId);
  }
}
