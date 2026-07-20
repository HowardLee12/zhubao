import type { ZodType } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

import { configuredAppOrigin, verifyCsrf } from "@/server/api/csrf";
import { parseIfMatch } from "@/server/api/headers";
import { authenticateAndRateLimit, parseUuidParam } from "@/server/api/operations-route";
import { ApiProblem } from "@/server/api/problem";
import { parseJsonBody, resolveRequestId } from "@/server/api/request";
import { apiJsonResponse, apiProblemResponse, internalApiProblem } from "@/server/supabase/http";
import { createSupabaseServerClient } from "@/server/supabase/server";

interface ActionArgs<TInput> {
  supabase: Pick<SupabaseClient, "auth" | "rpc">;
  organizationId: string;
  planId: string;
  expectedLockVersion: number;
  input: TInput;
  requestId: string;
}

interface RouteContext {
  params: Promise<{ orgId: string; id: string }>;
}

// Shared handler for the maintenance-plan transitions (pause/resume/complete/
// cancel). Each is an If-Match guarded mutation; role and state are enforced by
// the SECURITY DEFINER RPC. No Idempotency-Key: the RPCs are naturally idempotent
// on the target state.
export function makeMaintenanceActionRoute<TInput>(
  schema: ZodType<TInput>,
  action: (args: ActionArgs<TInput>) => Promise<Record<string, unknown>>,
) {
  return async function POST(request: Request, context: RouteContext): Promise<Response> {
    const requestId = resolveRequestId(request.headers.get("x-request-id"));
    try {
      verifyCsrf(request, configuredAppOrigin(request));
      const expectedLockVersion = parseIfMatch(request.headers.get("if-match"));
      const { orgId, id } = await context.params;
      const organizationId = parseUuidParam(orgId);
      const planId = parseUuidParam(id);
      const input = await parseJsonBody(request, schema);

      const supabase = await createSupabaseServerClient();
      await authenticateAndRateLimit(supabase, organizationId, "mutation");

      const data = await action({
        supabase,
        organizationId,
        planId,
        expectedLockVersion,
        input,
        requestId,
      });
      const lockVersion = data.lockVersion;
      return apiJsonResponse(
        { data },
        {
          requestId,
          headers: typeof lockVersion === "number" ? { etag: `"${lockVersion}"` } : {},
        },
      );
    } catch (error) {
      const safeError = error instanceof ApiProblem ? error : internalApiProblem();
      return apiProblemResponse(safeError, request, requestId);
    }
  };
}
