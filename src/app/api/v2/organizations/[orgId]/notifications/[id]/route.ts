import { z } from "zod";

import { notificationViewSchema } from "@/schemas/notification";
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

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ orgId: string; id: string }>;
}

// The detail view extends the redacted list view with an append-only attempt
// history (outcome / error code / timestamps only — never provider ids or cost).
const attemptSchema = z
  .object({
    attemptNo: z.number().int(),
    outcome: z.string(),
    errorCode: z.string().nullable(),
    startedAt: z.string(),
    finishedAt: z.string().nullable(),
  })
  .strict();

const detailSchema = notificationViewSchema.extend({
  attempts: z.array(attemptSchema),
});

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const requestId = resolveRequestId(request.headers.get("x-request-id"));

  try {
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

    const { data, error } = await supabase.rpc("get_notification_detail", {
      target_org: parsedOrgId.data,
      p_notification_id: parsedId.data,
    });
    if (error) throw mapNotificationRpcError(error);

    const detail = detailSchema.safeParse(data);
    if (!detail.success) throw internalApiProblem();

    return apiJsonResponse({ data: detail.data }, { requestId });
  } catch (error) {
    const safeError = error instanceof ApiProblem ? error : internalApiProblem();
    return apiProblemResponse(safeError, request, requestId);
  }
}
