import { z } from "zod";

import { encodeKeysetCursor, decodeKeysetCursor } from "@/schemas/keyset-cursor";
import {
  pilotInboxRpcResultSchema,
  toPilotInboxItem,
} from "@/schemas/pilot-inbox";
import { ApiProblem } from "@/server/api/problem";
import { resolveRequestId } from "@/server/api/request";
import { mapServiceRequestRpcError } from "@/server/api/service-request-errors";
import {
  apiJsonResponse,
  apiProblemResponse,
  authenticationRequiredProblem,
  internalApiProblem,
} from "@/server/supabase/http";
import { createSupabaseServerClient } from "@/server/supabase/server";

export const dynamic = "force-dynamic";

// The keyset overload of list_pilot_service_requests pushes the status filter and
// (created_at, id) < cursor predicate into SQL and caps at 100 rows per page. The
// route owns opaque cursor encode/decode; the RPC returns no cursor field.
const MAX_PAGE_SIZE = 100;

const inboxQuerySchema = z
  .object({
    status: z
      .enum([
        "new",
        "triaged",
        "quoting",
        "quoted",
        "converted",
        "declined",
        "cancelled",
      ])
      .optional(),
    limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(50),
    cursor: z.string().min(1).max(1024).optional(),
  })
  .strict();

interface RouteContext {
  params: Promise<{ orgId: string }>;
}

function invalidCursorProblem(): ApiProblem {
  return new ApiProblem({
    status: 400,
    code: "VALIDATION_FAILED",
    title: "分頁游標不正確",
    detail: "分頁游標已失效，請重新從第一頁載入。",
  });
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const requestId = resolveRequestId(request.headers.get("x-request-id"));

  try {
    const { orgId: rawOrgId } = await context.params;
    const parsedOrgId = z.uuid().safeParse(rawOrgId);
    if (!parsedOrgId.success) throw ApiProblem.fromZod(parsedOrgId.error);

    const url = new URL(request.url);
    const parsedQuery = inboxQuerySchema.safeParse({
      status: url.searchParams.get("status") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
      cursor: url.searchParams.get("cursor") ?? undefined,
    });
    if (!parsedQuery.success) throw ApiProblem.fromZod(parsedQuery.error);
    const { status, limit, cursor } = parsedQuery.data;

    let afterCreatedAt: string | null = null;
    let afterId: string | null = null;
    if (cursor) {
      try {
        const position = decodeKeysetCursor(cursor);
        afterCreatedAt = position.createdAt;
        afterId = position.id;
      } catch {
        throw invalidCursorProblem();
      }
    }

    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) throw authenticationRequiredProblem();

    const { data, error } = await supabase.rpc("list_pilot_service_requests", {
      p_organization_id: parsedOrgId.data,
      p_status: status ?? null,
      p_after_created_at: afterCreatedAt,
      p_after_id: afterId,
      p_limit: limit,
    });
    if (error) throw mapServiceRequestRpcError(error);

    const result = pilotInboxRpcResultSchema.safeParse(data);
    if (!result.success) throw internalApiProblem();

    const items = result.data.items.map(toPilotInboxItem);
    const hasMore = result.data.items.length === limit;
    const last = result.data.items.at(-1);
    const nextCursor =
      hasMore && last
        ? encodeKeysetCursor({ createdAt: last.createdAt, id: last.id })
        : null;

    return apiJsonResponse({ data: items, meta: { hasMore, nextCursor } }, { requestId });
  } catch (error) {
    const safeError = error instanceof ApiProblem ? error : internalApiProblem();
    return apiProblemResponse(safeError, request, requestId);
  }
}
