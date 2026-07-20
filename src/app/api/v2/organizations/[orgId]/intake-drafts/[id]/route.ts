import { z } from "zod";

import { intakeDraftDetailSchema } from "@/schemas/intake-draft";
import { ApiProblem } from "@/server/api/problem";
import { resolveRequestId } from "@/server/api/request";
import { getIntakeDraftDetail } from "@/server/intake/read";
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

function notFound(): ApiProblem {
  return new ApiProblem({
    status: 404,
    code: "NOT_FOUND",
    title: "找不到進件草稿",
    detail: "找不到這個進件草稿。",
  });
}

// GET one draft's detail: the immutable original-message timeline + the AI-extracted
// fields (with per-field provenance + confidence) + missing fields. RLS scopes the
// read; a draft not visible to the caller is a non-leaky 404. Read-only, no CSRF.
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

    const detail = await getIntakeDraftDetail(supabase, parsedOrgId.data, parsedId.data);
    if (!detail) throw notFound();

    return apiJsonResponse({ data: intakeDraftDetailSchema.parse(detail) }, { requestId });
  } catch (error) {
    const safeError = error instanceof ApiProblem ? error : internalApiProblem();
    return apiProblemResponse(safeError, request, requestId);
  }
}
