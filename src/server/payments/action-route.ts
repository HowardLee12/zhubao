import type { ZodType } from "zod";

import { configuredAppOrigin, verifyCsrf } from "@/server/api/csrf";
import { parseIfMatch, resolveStaffIdempotencyKey } from "@/server/api/headers";
import { authenticateAndRateLimit, parseUuidParam } from "@/server/api/operations-route";
import { ApiProblem } from "@/server/api/problem";
import { parseJsonBody, resolveRequestId } from "@/server/api/request";
import { apiJsonResponse, apiProblemResponse, internalApiProblem } from "@/server/supabase/http";
import { createSupabaseServerClient } from "@/server/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";

interface ActionArgs<TInput> {
  supabase: Pick<SupabaseClient, "auth" | "rpc">;
  organizationId: string;
  milestoneId: string;
  expectedLockVersion: number;
  input: TInput;
  idempotencyKey: string;
  requestId: string;
}

interface RouteContext {
  params: Promise<{ orgId: string; id: string }>;
}

// Shared handler for the payment-milestone state actions. Every action is an
// If-Match + Idempotency-Key guarded mutation: CSRF -> If-Match -> Idempotency ->
// authenticate + rate-limit -> RPC (which is the authority on role and state). The
// action's role is enforced inside the SECURITY DEFINER RPC.
export function makePaymentActionRoute<TInput>(
  schema: ZodType<TInput>,
  action: (args: ActionArgs<TInput>) => Promise<Record<string, unknown>>,
) {
  return async function POST(request: Request, context: RouteContext): Promise<Response> {
    const requestId = resolveRequestId(request.headers.get("x-request-id"));
    try {
      verifyCsrf(request, configuredAppOrigin(request));
      const expectedLockVersion = parseIfMatch(request.headers.get("if-match"));
      const idempotencyKey = resolveStaffIdempotencyKey(request.headers.get("idempotency-key"));

      const { orgId, id } = await context.params;
      const organizationId = parseUuidParam(orgId);
      const milestoneId = parseUuidParam(id);
      const input = await parseJsonBody(request, schema);

      const supabase = await createSupabaseServerClient();
      await authenticateAndRateLimit(supabase, organizationId, "mutation");

      const data = await action({
        supabase,
        organizationId,
        milestoneId,
        expectedLockVersion,
        input,
        idempotencyKey,
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
