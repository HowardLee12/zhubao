import { createPilotOrganizationSchema, pilotOrganizationRpcResultSchema } from "@/schemas/organization";
import { configuredAppOrigin, verifyCsrf } from "@/server/api/csrf";
import { requireStaffIdempotencyKey } from "@/server/api/headers";
import { ApiProblem } from "@/server/api/problem";
import { parseJsonBody, resolveRequestId } from "@/server/api/request";
import { mapCreateOrganizationError } from "@/server/supabase/errors";
import {
  apiJsonResponse,
  apiProblemResponse,
  authenticationRequiredProblem,
  internalApiProblem,
} from "@/server/supabase/http";
import { createPublicIntakeToken } from "@/server/supabase/public-token";
import { createSupabaseServerClient } from "@/server/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const requestId = resolveRequestId(request.headers.get("x-request-id"));

  try {
    verifyCsrf(request, configuredAppOrigin(request));
    const idempotencyKey = requireStaffIdempotencyKey(request.headers.get("idempotency-key"));

    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      throw authenticationRequiredProblem();
    }

    const input = await parseJsonBody(request, createPilotOrganizationSchema);
    const publicToken = createPublicIntakeToken();
    const { data, error } = await supabase.rpc("create_pilot_organization", {
      p_name: input.name,
      p_slug: input.slug,
      p_industry_template: input.industryTemplate,
      p_timezone: input.timezone,
      p_currency: input.currency,
      p_owner_display_name: input.ownerDisplayName,
      p_public_intake_token_hash_hex: publicToken.hashHex,
      p_idempotency_key: idempotencyKey,
    });

    if (error) {
      throw mapCreateOrganizationError(error);
    }

    const result = pilotOrganizationRpcResultSchema.safeParse(data);
    if (!result.success) {
      throw internalApiProblem();
    }

    const publicIntakeUrl = new URL(
      `/request/${publicToken.rawToken}`,
      request.url,
    ).toString();

    return apiJsonResponse(
      {
        data: {
          ...result.data,
          publicIntakeUrl,
        },
      },
      {
        status: 201,
        requestId,
        headers: {
          location: `/api/v2/organizations/${result.data.organization.id}`,
        },
      },
    );
  } catch (error) {
    const safeError = error instanceof ApiProblem ? error : internalApiProblem();
    return apiProblemResponse(safeError, request, requestId);
  }
}
