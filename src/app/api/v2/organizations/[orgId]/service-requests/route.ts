import { z } from "zod";

import {
  pilotInboxRpcResultSchema,
  toPilotInboxItem,
  type PilotInboxItem,
} from "@/schemas/pilot-inbox";
import { ApiProblem } from "@/server/api/problem";
import { resolveRequestId } from "@/server/api/request";
import {
  apiJsonResponse,
  apiProblemResponse,
  authenticationRequiredProblem,
  internalApiProblem,
} from "@/server/supabase/http";
import { createSupabaseServerClient } from "@/server/supabase/server";

export const dynamic = "force-dynamic";

// The RPC is pgTAP-pinned to (uuid, integer) and caps at 100 rows. Status
// filtering and pagination happen in the route against that bounded page so
// meta.hasMore stays honest for the filtered view.
const RPC_MAX_PAGE_SIZE = 100;

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
    limit: z.coerce.number().int().min(1).max(RPC_MAX_PAGE_SIZE).default(50),
  })
  .strict();

interface RouteContext {
  params: Promise<{ orgId: string }>;
}

function mapInboxError(error: { message?: string; details?: string }): ApiProblem {
  const combined = `${error.message ?? ""} ${error.details ?? ""}`;
  if (combined.includes("AUTH_REQUIRED")) {
    return authenticationRequiredProblem();
  }
  if (combined.includes("FORBIDDEN")) {
    return new ApiProblem({
      status: 403,
      code: "FORBIDDEN",
      title: "沒有權限",
      detail: "你沒有權限查看這個店家的案件。",
    });
  }
  return internalApiProblem();
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
    });
    if (!parsedQuery.success) throw ApiProblem.fromZod(parsedQuery.error);
    const { status, limit } = parsedQuery.data;

    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) throw authenticationRequiredProblem();

    const { data, error } = await supabase.rpc("list_pilot_service_requests", {
      p_organization_id: parsedOrgId.data,
      p_page_size: RPC_MAX_PAGE_SIZE,
    });
    if (error) throw mapInboxError(error);

    const result = pilotInboxRpcResultSchema.safeParse(data);
    if (!result.success) throw internalApiProblem();

    const filtered: PilotInboxItem[] = result.data.items
      .filter((row) => (status ? row.status === status : true))
      .map(toPilotInboxItem);
    const page = filtered.slice(0, limit);
    const hasMore = filtered.length > limit;

    return apiJsonResponse(
      {
        data: page,
        meta: { hasMore, nextCursor: null },
      },
      { requestId },
    );
  } catch (error) {
    const safeError = error instanceof ApiProblem ? error : internalApiProblem();
    return apiProblemResponse(safeError, request, requestId);
  }
}
