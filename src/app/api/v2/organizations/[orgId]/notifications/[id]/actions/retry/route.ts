import { z } from "zod";

import { configuredAppOrigin, verifyCsrf } from "@/server/api/csrf";
import { resolveStaffIdempotencyKey } from "@/server/api/headers";
import { ApiProblem } from "@/server/api/problem";
import { resolveRequestId } from "@/server/api/request";
import { mapNotificationRpcError } from "@/server/api/notification-errors";
import {
  apiJsonResponse,
  apiProblemResponse,
  authenticationRequiredProblem,
  internalApiProblem,
} from "@/server/supabase/http";
import { createSupabaseServerClient } from "@/server/supabase/server";

// Manual resend. Only a FAILED notification can be retried (the RPC guards the
// from-state and raises NOTIFICATION_NOT_RETRYABLE otherwise). retry_notification
// resets the exhausted counter one step and re-queues with next_attempt_at = now,
// so an operator-triggered resend becomes claimable for exactly one more attempt.

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ orgId: string; id: string }>;
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const requestId = resolveRequestId(request.headers.get("x-request-id"));

  try {
    verifyCsrf(request, configuredAppOrigin(request));
    // A resend is naturally idempotent at the DB (failed -> pending is a no-op on a
    // row already pending); we still accept/mint a key for a consistent staff flow.
    resolveStaffIdempotencyKey(request.headers.get("idempotency-key"));

    const { orgId: rawOrgId, id: rawId } = await context.params;
    const parsedOrgId = z.uuid().safeParse(rawOrgId);
    const parsedId = z.uuid().safeParse(rawId);
    if (!parsedOrgId.success) throw ApiProblem.fromZod(parsedOrgId.error);
    if (!parsedId.success) throw ApiProblem.fromZod(parsedId.error);

    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) throw authenticationRequiredProblem();

    const { data, error } = await supabase.rpc("retry_notification", {
      target_org: parsedOrgId.data,
      p_notification_id: parsedId.data,
    });
    if (error) throw mapNotificationRpcError(error);

    return apiJsonResponse({ data }, { requestId });
  } catch (error) {
    const safeError = error instanceof ApiProblem ? error : internalApiProblem();
    return apiProblemResponse(safeError, request, requestId);
  }
}
