import { z } from "zod";

import { lineChannelDisableSchema } from "@/schemas/line-channel";
import { configuredAppOrigin, verifyCsrf } from "@/server/api/csrf";
import { resolveStaffIdempotencyKey } from "@/server/api/headers";
import { ApiProblem } from "@/server/api/problem";
import { parseJsonBody, resolveRequestId } from "@/server/api/request";
import { mapLineChannelRpcError } from "@/server/api/line-channel-errors";
import {
  apiJsonResponse,
  apiProblemResponse,
  authenticationRequiredProblem,
  internalApiProblem,
} from "@/server/supabase/http";
import { createSupabaseServerClient } from "@/server/supabase/server";

// Kill switch. Disabling a channel pauses ALL outbound LINE delivery for it
// (claim_notifications excludes disabled channels) and records a hash-chained
// audit event. owner/admin only; the RPC gates the role internally. Idempotent:
// disabling an already-disabled channel is a no-op with no duplicate event.

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ orgId: string; id: string }>;
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const requestId = resolveRequestId(request.headers.get("x-request-id"));

  try {
    verifyCsrf(request, configuredAppOrigin(request));
    resolveStaffIdempotencyKey(request.headers.get("idempotency-key"));

    const { orgId: rawOrgId, id: rawId } = await context.params;
    const parsedOrgId = z.uuid().safeParse(rawOrgId);
    const parsedId = z.uuid().safeParse(rawId);
    if (!parsedOrgId.success) throw ApiProblem.fromZod(parsedOrgId.error);
    if (!parsedId.success) throw ApiProblem.fromZod(parsedId.error);

    // The body is optional; when present it must be a valid { reason } object.
    let reason: string | null = null;
    const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
    if (contentType.startsWith("application/json")) {
      const body = await parseJsonBody(request, lineChannelDisableSchema);
      reason = body.reason ?? null;
    }

    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) throw authenticationRequiredProblem();

    const { data, error } = await supabase.rpc("disable_line_channel", {
      target_org: parsedOrgId.data,
      p_channel_id: parsedId.data,
      p_reason: reason,
    });
    if (error) throw mapLineChannelRpcError(error);

    return apiJsonResponse({ data }, { requestId });
  } catch (error) {
    const safeError = error instanceof ApiProblem ? error : internalApiProblem();
    return apiProblemResponse(safeError, request, requestId);
  }
}
