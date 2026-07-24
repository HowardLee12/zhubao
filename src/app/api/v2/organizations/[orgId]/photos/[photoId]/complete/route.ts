import { z } from "zod";

import { configuredAppOrigin, verifyCsrf } from "@/server/api/csrf";
import { ApiProblem } from "@/server/api/problem";
import { resolveRequestId } from "@/server/api/request";
import { mapWorkOrderRpcError } from "@/server/api/work-order-errors";
import { completeWorkOrderPhoto } from "@/server/work-orders/gateway";
import {
  apiJsonResponse,
  apiProblemResponse,
  authenticationRequiredProblem,
  internalApiProblem,
} from "@/server/supabase/http";
import { createSupabaseServerClient } from "@/server/supabase/server";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ orgId: string; photoId: string }>;
}

// Verify-and-mark-ready. The route resolves the reserved object's storage path via
// the authz RPC, downloads and fingerprints the real bytes, then calls
// complete_work_order_photo which cross-checks the actuals against the declared
// values before flipping pending -> ready. No request body: verification is
// server-computed, never client-asserted.
export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const requestId = resolveRequestId(request.headers.get("x-request-id"));

  try {
    verifyCsrf(request, configuredAppOrigin(request));

    const { orgId: rawOrgId, photoId: rawId } = await context.params;
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

    // Resolve the storage path through the authz RPC (manager OR assigned). This
    // both authorizes the caller and yields the object path to download.
    const grantResult = await supabase.rpc("get_work_order_photo_read_url", {
      target_org: parsedOrgId.data,
      target_photo: parsedId.data,
    });
    if (grantResult.error) throw mapWorkOrderRpcError(grantResult.error);
    const grant = grantResult.data as { storagePath?: string } | null;
    if (!grant || typeof grant.storagePath !== "string") throw internalApiProblem();

    const data = await completeWorkOrderPhoto({
      supabase,
      organizationId: parsedOrgId.data,
      photoId: parsedId.data,
      storagePath: grant.storagePath,
      requestId,
    });

    return apiJsonResponse({ data }, { requestId });
  } catch (error) {
    const safeError = error instanceof ApiProblem ? error : internalApiProblem();
    return apiProblemResponse(safeError, request, requestId);
  }
}
