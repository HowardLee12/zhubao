import { z } from "zod";

import { configuredAppOrigin, verifyCsrf } from "@/server/api/csrf";
import { requireStaffIdempotencyKey } from "@/server/api/headers";
import { ApiProblem } from "@/server/api/problem";
import { resolveRequestId } from "@/server/api/request";
import {
  apiJsonResponse,
  apiProblemResponse,
  authenticationRequiredProblem,
  internalApiProblem,
} from "@/server/supabase/http";
import { createPublicIntakeToken } from "@/server/supabase/public-token";
import { createSupabaseServerClient } from "@/server/supabase/server";

export const dynamic = "force-dynamic";

const rotationResultSchema = z
  .object({
    organizationId: z.uuid(),
    rotatedAt: z.iso.datetime({ offset: true }),
    expiresAt: z.iso.datetime({ offset: true }),
  })
  .strict();

interface RouteContext {
  params: Promise<{ orgId: string }>;
}

function mapRotationError(error: { message?: string; details?: string }): ApiProblem {
  const combined = `${error.message ?? ""} ${error.details ?? ""}`;
  if (combined.includes("AUTH_REQUIRED")) return authenticationRequiredProblem();
  if (combined.includes("FORBIDDEN")) {
    return new ApiProblem({
      status: 403,
      code: "FORBIDDEN",
      title: "沒有權限",
      detail: "只有店家擁有者或管理員可以重新產生公開連結。",
    });
  }
  if (combined.includes("PILOT_IDEMPOTENCY_CONFLICT")) {
    return new ApiProblem({
      status: 409,
      code: "IDEMPOTENCY_CONFLICT",
      title: "重複要求內容不一致",
      detail: "這個冪等鍵已用於不同內容的要求，請重新整理頁面後再試。",
    });
  }
  if (combined.includes("PILOT_IDEMPOTENCY_IN_PROGRESS")) {
    return new ApiProblem({
      status: 409,
      code: "IDEMPOTENCY_IN_PROGRESS",
      title: "要求處理中",
      detail: "先前的要求仍在處理，請稍後再試一次。",
    });
  }
  return internalApiProblem();
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const requestId = resolveRequestId(request.headers.get("x-request-id"));

  try {
    verifyCsrf(request, configuredAppOrigin(request));
    const idempotencyKey = requireStaffIdempotencyKey(request.headers.get("idempotency-key"));

    const { orgId: rawOrgId } = await context.params;
    const parsedOrgId = z.uuid().safeParse(rawOrgId);
    if (!parsedOrgId.success) throw ApiProblem.fromZod(parsedOrgId.error);

    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) throw authenticationRequiredProblem();

    const token = createPublicIntakeToken();
    const { data, error } = await supabase.rpc("rotate_pilot_intake_token", {
      p_organization_id: parsedOrgId.data,
      p_new_token_hash_hex: token.hashHex,
      p_idempotency_key: idempotencyKey,
    });
    if (error) throw mapRotationError(error);

    const result = rotationResultSchema.safeParse(data);
    if (!result.success || result.data.organizationId !== parsedOrgId.data) {
      throw internalApiProblem();
    }

    return apiJsonResponse(
      {
        data: {
          publicIntakeUrl: new URL(`/request/${token.rawToken}`, request.url).toString(),
        },
      },
      { requestId },
    );
  } catch (error) {
    return apiProblemResponse(
      error instanceof ApiProblem ? error : internalApiProblem(),
      request,
      requestId,
    );
  }
}
