import { z } from "zod";

import { scheduleConflictsCheckSchema } from "@/schemas/work-order-schedule";
import { configuredAppOrigin, verifyCsrf } from "@/server/api/csrf";
import { ApiProblem } from "@/server/api/problem";
import { parseJsonBody, resolveRequestId } from "@/server/api/request";
import { mapWorkOrderRpcError } from "@/server/api/work-order-errors";
import {
  apiJsonResponse,
  apiProblemResponse,
  authenticationRequiredProblem,
  internalApiProblem,
} from "@/server/supabase/http";
import { createSupabaseServerClient } from "@/server/supabase/server";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ orgId: string }>;
}

const conflictSchema = z
  .object({
    membershipId: z.uuid(),
    workOrderId: z.uuid(),
    workOrderNo: z.string(),
    startsAt: z.string().nullable(),
    endsAt: z.string().nullable(),
  })
  .strict();

const conflictsResultSchema = z.object({ conflicts: z.array(conflictSchema) }).strict();

// POST conflicts:check — a read-only overlap query, but it is a POST (body carries
// the candidate roster) so it is CSRF-protected like a mutation. It does not write.
export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const requestId = resolveRequestId(request.headers.get("x-request-id"));

  try {
    verifyCsrf(request, configuredAppOrigin(request));
    const { orgId: rawOrgId } = await context.params;
    const parsedOrgId = z.uuid().safeParse(rawOrgId);
    if (!parsedOrgId.success) throw ApiProblem.fromZod(parsedOrgId.error);

    const body = await parseJsonBody(request, scheduleConflictsCheckSchema);

    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) throw authenticationRequiredProblem();

    const { data, error } = await supabase.rpc("check_schedule_conflicts", {
      target_org: parsedOrgId.data,
      p_membership_ids: body.membershipIds,
      p_starts_at: body.startsAt,
      p_ends_at: body.endsAt,
      p_exclude_work_order: body.excludeWorkOrderId ?? null,
    });
    if (error) throw mapWorkOrderRpcError(error);

    const result = conflictsResultSchema.safeParse(data);
    if (!result.success) throw internalApiProblem();

    return apiJsonResponse({ data: result.data }, { requestId });
  } catch (error) {
    const safeError = error instanceof ApiProblem ? error : internalApiProblem();
    return apiProblemResponse(safeError, request, requestId);
  }
}
