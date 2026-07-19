import { z } from "zod";

import {
  organizationMemberRowSchema,
  toOrganizationMember,
} from "@/schemas/organization-member";
import { authorizeOrgManager } from "@/server/api/org-authorization";
import { ApiProblem } from "@/server/api/problem";
import { resolveRequestId } from "@/server/api/request";
import { mapServiceRequestRpcError } from "@/server/api/service-request-errors";
import {
  apiJsonResponse,
  apiProblemResponse,
  internalApiProblem,
} from "@/server/supabase/http";
import { createSupabaseServerClient } from "@/server/supabase/server";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ orgId: string }>;
}

// Pilot-only assignment projection. General membership CRUD remains on the
// documented /memberships surface; this endpoint intentionally exposes only
// the active operational fields needed by the triage picker.
export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const requestId = resolveRequestId(request.headers.get("x-request-id"));

  try {
    const { orgId: rawOrgId } = await context.params;
    const parsedOrgId = z.uuid().safeParse(rawOrgId);
    if (!parsedOrgId.success) throw ApiProblem.fromZod(parsedOrgId.error);

    const supabase = await createSupabaseServerClient();
    await authorizeOrgManager(supabase, parsedOrgId.data);

    const { data, error } = await supabase.rpc("list_pilot_assignable_members", {
      p_organization_id: parsedOrgId.data,
    });
    if (error) throw mapServiceRequestRpcError(error);

    const rows = z.array(organizationMemberRowSchema).safeParse(data ?? []);
    if (!rows.success) throw internalApiProblem();

    return apiJsonResponse(
      { data: rows.data.map(toOrganizationMember) },
      { requestId },
    );
  } catch (error) {
    const safeError = error instanceof ApiProblem ? error : internalApiProblem();
    return apiProblemResponse(safeError, request, requestId);
  }
}
