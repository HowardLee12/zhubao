import { z } from "zod";

import { intakeDraftListItemSchema } from "@/schemas/intake-draft";
import { ApiProblem } from "@/server/api/problem";
import { resolveRequestId } from "@/server/api/request";
import { listIntakeDrafts } from "@/server/intake/read";
import {
  apiJsonResponse,
  apiProblemResponse,
  authenticationRequiredProblem,
  internalApiProblem,
} from "@/server/supabase/http";
import { createSupabaseServerClient } from "@/server/supabase/server";

export const dynamic = "force-dynamic";

const MAX_PAGE_SIZE = 100;

interface RouteContext {
  params: Promise<{ orgId: string }>;
}

const querySchema = z
  .object({
    status: z
      .enum(["pending_review", "confirmed", "dismissed", "superseded"])
      .default("pending_review"),
    limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(50),
  })
  .strict();

// GET the org's intake-draft inbox (待確認進件草稿). RLS + the owner/admin/dispatcher
// SELECT policy enforce tenant isolation and role gating in the database; a member of
// another org (or without the role) simply sees no rows. Read-only, no CSRF.
export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const requestId = resolveRequestId(request.headers.get("x-request-id"));

  try {
    const { orgId: rawOrgId } = await context.params;
    const parsedOrgId = z.uuid().safeParse(rawOrgId);
    if (!parsedOrgId.success) throw ApiProblem.fromZod(parsedOrgId.error);

    const url = new URL(request.url);
    const parsedQuery = querySchema.safeParse({
      status: url.searchParams.get("status") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
    });
    if (!parsedQuery.success) throw ApiProblem.fromZod(parsedQuery.error);

    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) throw authenticationRequiredProblem();

    const drafts = await listIntakeDrafts(
      supabase,
      parsedOrgId.data,
      parsedQuery.data.status,
      parsedQuery.data.limit,
    );
    const items = drafts.map((draft) => intakeDraftListItemSchema.parse(draft));

    return apiJsonResponse({ data: items }, { requestId });
  } catch (error) {
    const safeError = error instanceof ApiProblem ? error : internalApiProblem();
    return apiProblemResponse(safeError, request, requestId);
  }
}
