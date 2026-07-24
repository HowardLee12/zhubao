import { z } from "zod";

import {
  createPilotMemberSchema,
  organizationMemberRowSchema,
  toOrganizationMember,
} from "@/schemas/organization-member";
import { authorizeOrgManager } from "@/server/api/org-authorization";
import { configuredAppOrigin, verifyCsrf } from "@/server/api/csrf";
import { resolveStaffIdempotencyKey } from "@/server/api/headers";
import { mapMembershipRpcError } from "@/server/api/membership-errors";
import { ApiProblem } from "@/server/api/problem";
import { parseJsonBody, resolveRequestId } from "@/server/api/request";
import { provisionAuthUserId } from "@/server/api/provision-auth-user";
import {
  apiJsonResponse,
  apiProblemResponse,
  internalApiProblem,
} from "@/server/supabase/http";
import { createAdminSupabaseClient } from "@/server/supabase/admin";
import { createSupabaseServerClient } from "@/server/supabase/server";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ orgId: string }>;
}

// `assignable` (default) keeps back-compat with the triage assignment picker and
// returns active operational members only. `all` powers the team-management roster
// and additionally surfaces invited/suspended members (never 'removed').
const memberScopeSchema = z.enum(["assignable", "all"]).default("assignable");

const SCOPE_RPC = {
  assignable: "list_pilot_assignable_members",
  all: "list_pilot_members",
} as const;

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const requestId = resolveRequestId(request.headers.get("x-request-id"));

  try {
    const { orgId: rawOrgId } = await context.params;
    const parsedOrgId = z.uuid().safeParse(rawOrgId);
    if (!parsedOrgId.success) throw ApiProblem.fromZod(parsedOrgId.error);

    const url = new URL(request.url);
    const parsedScope = memberScopeSchema.safeParse(url.searchParams.get("scope") ?? undefined);
    if (!parsedScope.success) throw ApiProblem.fromZod(parsedScope.error);

    const supabase = await createSupabaseServerClient();
    await authorizeOrgManager(supabase, parsedOrgId.data);

    const { data, error } = await supabase.rpc(SCOPE_RPC[parsedScope.data], {
      p_organization_id: parsedOrgId.data,
    });
    if (error) throw mapMembershipRpcError(error);

    const rows = z.array(organizationMemberRowSchema).safeParse(data ?? []);
    if (!rows.success) throw internalApiProblem();

    return apiJsonResponse(
      { data: rows.data.map((row) => toOrganizationMember(row)) },
      { requestId },
    );
  } catch (error) {
    const safeError = error instanceof ApiProblem ? error : internalApiProblem();
    return apiProblemResponse(safeError, request, requestId);
  }
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const requestId = resolveRequestId(request.headers.get("x-request-id"));

  try {
    verifyCsrf(request, configuredAppOrigin(request));

    const { orgId: rawOrgId } = await context.params;
    const parsedOrgId = z.uuid().safeParse(rawOrgId);
    if (!parsedOrgId.success) throw ApiProblem.fromZod(parsedOrgId.error);

    const body = await parseJsonBody(request, createPilotMemberSchema, { maxBytes: 4096 });
    const idempotencyKey = resolveStaffIdempotencyKey(request.headers.get("idempotency-key"));

    const supabase = await createSupabaseServerClient();
    await authorizeOrgManager(supabase, parsedOrgId.data);

    // Provision (or reuse) the auth account for this email BEFORE writing the
    // membership, so the new member can later sign in via magic link. Failures
    // surface as a clean 5xx; the service-role key is never placed in the message.
    const admin = createAdminSupabaseClient();
    const userId = await provisionAuthUserId(admin, body.email);

    const { data, error } = await supabase.rpc("invite_pilot_member", {
      p_organization_id: parsedOrgId.data,
      p_user_id: userId,
      p_display_name: body.displayName,
      p_role: body.role,
      p_phone: body.phone,
      p_idempotency_key: idempotencyKey,
    });
    if (error) throw mapMembershipRpcError(error);

    const row = organizationMemberRowSchema.safeParse(data);
    if (!row.success) throw internalApiProblem();

    return apiJsonResponse({ data: toOrganizationMember(row.data) }, { status: 201, requestId });
  } catch (error) {
    const safeError = error instanceof ApiProblem ? error : internalApiProblem();
    return apiProblemResponse(safeError, request, requestId);
  }
}
