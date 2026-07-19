import { z } from "zod";

import {
  pilotSettingsRpcResultSchema,
  updatePilotSettingsSchema,
} from "@/schemas/pilot-settings";
import { configuredAppOrigin, verifyCsrf } from "@/server/api/csrf";
import { ApiProblem } from "@/server/api/problem";
import { parseJsonBody, resolveRequestId } from "@/server/api/request";
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

function mapSettingsError(error: { message?: string; details?: string }): ApiProblem {
  const combined = `${error.message ?? ""} ${error.details ?? ""}`;
  if (combined.includes("AUTH_REQUIRED")) return authenticationRequiredProblem();
  if (combined.includes("FORBIDDEN")) {
    return new ApiProblem({
      status: 403,
      code: "FORBIDDEN",
      title: "沒有權限",
      detail: "只有店家擁有者或管理員可以修改這些設定。",
    });
  }
  if (combined.includes("STALE_VERSION")) {
    return new ApiProblem({
      status: 409,
      code: "STALE_VERSION",
      title: "設定已被更新",
      detail: "請重新載入最新設定後再儲存。",
    });
  }
  return internalApiProblem();
}

async function authenticatedContext(rawOrgId: string) {
  const parsedOrgId = z.uuid().safeParse(rawOrgId);
  if (!parsedOrgId.success) throw ApiProblem.fromZod(parsedOrgId.error);

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) throw authenticationRequiredProblem();

  return { organizationId: parsedOrgId.data, supabase };
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const requestId = resolveRequestId(request.headers.get("x-request-id"));

  try {
    const { orgId } = await context.params;
    const { organizationId, supabase } = await authenticatedContext(orgId);
    const { data, error } = await supabase.rpc("get_pilot_organization_settings", {
      p_organization_id: organizationId,
    });
    if (error) throw mapSettingsError(error);

    const parsed = pilotSettingsRpcResultSchema.safeParse(data);
    if (!parsed.success) throw internalApiProblem();
    return apiJsonResponse({ data: parsed.data }, { requestId });
  } catch (error) {
    return apiProblemResponse(
      error instanceof ApiProblem ? error : internalApiProblem(),
      request,
      requestId,
    );
  }
}

export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  const requestId = resolveRequestId(request.headers.get("x-request-id"));

  try {
    verifyCsrf(request, configuredAppOrigin(request));
    const { orgId } = await context.params;
    const { organizationId, supabase } = await authenticatedContext(orgId);
    const input = await parseJsonBody(request, updatePilotSettingsSchema, {
      maxBytes: 16 * 1024,
    });
    const { data, error } = await supabase.rpc("update_pilot_organization_settings", {
      p_organization_id: organizationId,
      p_settings_patch: {
        name: input.name,
        intakeHeadline: input.intakeHeadline,
        privacyNotice: input.privacyNotice,
      },
      p_expected_lock_version: input.lockVersion,
    });
    if (error) throw mapSettingsError(error);

    const parsed = pilotSettingsRpcResultSchema.safeParse(data);
    if (!parsed.success) throw internalApiProblem();
    return apiJsonResponse({ data: parsed.data }, { requestId });
  } catch (error) {
    return apiProblemResponse(
      error instanceof ApiProblem ? error : internalApiProblem(),
      request,
      requestId,
    );
  }
}
