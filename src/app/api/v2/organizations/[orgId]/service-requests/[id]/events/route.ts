import { z } from "zod";

import {
  eventRowSchema,
  toEventDto,
} from "@/schemas/service-request-event";
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

const MAX_PAGE_SIZE = 100;

const eventQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(50),
    afterSequence: z.coerce.number().int().min(1).optional(),
  })
  .strict();

interface RouteContext {
  params: Promise<{ orgId: string; id: string }>;
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const requestId = resolveRequestId(request.headers.get("x-request-id"));

  try {
    const { orgId: rawOrgId, id: rawId } = await context.params;
    const parsedOrgId = z.uuid().safeParse(rawOrgId);
    const parsedId = z.uuid().safeParse(rawId);
    if (!parsedOrgId.success) throw ApiProblem.fromZod(parsedOrgId.error);
    if (!parsedId.success) throw ApiProblem.fromZod(parsedId.error);

    const url = new URL(request.url);
    const parsedQuery = eventQuerySchema.safeParse({
      limit: url.searchParams.get("limit") ?? undefined,
      afterSequence: url.searchParams.get("afterSequence") ?? undefined,
    });
    if (!parsedQuery.success) throw ApiProblem.fromZod(parsedQuery.error);
    const { limit, afterSequence } = parsedQuery.data;

    const supabase = await createSupabaseServerClient();
    await authorizeOrgManager(supabase, parsedOrgId.data);

    const { data, error } = await supabase.rpc("list_pilot_service_request_events", {
      p_organization_id: parsedOrgId.data,
      p_service_request_id: parsedId.data,
      p_after_sequence: afterSequence ?? null,
      p_limit: limit,
    });
    if (error) throw mapServiceRequestRpcError(error);

    const rows = z.array(eventRowSchema).safeParse(data ?? []);
    if (!rows.success) throw internalApiProblem();

    const items = rows.data.map((row) => toEventDto(row));
    const hasMore = items.length === limit;
    const nextCursor = hasMore ? (items.at(-1)?.chainSequence ?? null) : null;

    return apiJsonResponse({ data: items, meta: { hasMore, nextCursor } }, { requestId });
  } catch (error) {
    const safeError = error instanceof ApiProblem ? error : internalApiProblem();
    return apiProblemResponse(safeError, request, requestId);
  }
}
