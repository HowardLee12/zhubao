import { z } from "zod";

import { scheduleRangeQuerySchema } from "@/schemas/work-order-list";
import { ApiProblem } from "@/server/api/problem";
import { resolveRequestId } from "@/server/api/request";
import { mapWorkOrderRpcError } from "@/server/api/work-order-errors";
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

const scheduleItemSchema = z
  .object({
    id: z.uuid(),
    workOrderNo: z.string(),
    title: z.string(),
    status: z.string(),
    priority: z.string(),
    customerId: z.uuid(),
    projectId: z.uuid().nullable(),
    assetId: z.uuid().nullable(),
    scheduledStartAt: z.string().nullable(),
    scheduledEndAt: z.string().nullable(),
    completedAt: z.string().nullable(),
    lockVersion: z.number().int(),
    createdAt: z.string(),
    updatedAt: z.string(),
    assigneeCount: z.number().int(),
  })
  .strict();

const scheduleResultSchema = z
  .object({ organizationId: z.uuid(), items: z.array(scheduleItemSchema) })
  .strict();

type ScheduleItem = z.infer<typeof scheduleItemSchema>;

// list_work_orders caps a single page at 100 rows. The schedule board must never
// silently drop rows past that cap, so we page the keyset cursor across the whole
// (bounded, <=31-day) window. SCHEDULE_MAX_PAGES bounds the loop so a pathological
// org can't spin it forever; if we ever hit that ceiling we surface hasMore=true so
// the dispatcher is told the window was too dense rather than being silently blind.
const SCHEDULE_PAGE_SIZE = 100;
const SCHEDULE_MAX_PAGES = 50;

// GET schedule board window. from/to required and bounded to <=31 days. Technicians
// see only their own assignments (enforced by list_work_orders in the RPC).
export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const requestId = resolveRequestId(request.headers.get("x-request-id"));

  try {
    const { orgId: rawOrgId } = await context.params;
    const parsedOrgId = z.uuid().safeParse(rawOrgId);
    if (!parsedOrgId.success) throw ApiProblem.fromZod(parsedOrgId.error);

    const url = new URL(request.url);
    const parsedQuery = scheduleRangeQuerySchema.safeParse({
      from: url.searchParams.get("from") ?? undefined,
      to: url.searchParams.get("to") ?? undefined,
    });
    if (!parsedQuery.success) throw ApiProblem.fromZod(parsedQuery.error);

    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) throw authenticationRequiredProblem();

    const filters = {
      scheduledFrom: parsedQuery.data.from,
      scheduledTo: parsedQuery.data.to,
    };

    const items: ScheduleItem[] = [];
    let cursorCreatedAt: string | null = null;
    let cursorId: string | null = null;
    let hasMore = false;
    let page = 0;

    for (; page < SCHEDULE_MAX_PAGES; page += 1) {
      const { data, error } = await supabase.rpc("list_work_orders", {
        target_org: parsedOrgId.data,
        p_filters: filters,
        p_cursor_created_at: cursorCreatedAt,
        p_cursor_id: cursorId,
        p_page_size: SCHEDULE_PAGE_SIZE,
      });
      if (error) throw mapWorkOrderRpcError(error);

      const result = scheduleResultSchema.safeParse(data);
      if (!result.success) throw internalApiProblem();

      const pageItems = result.data.items;
      items.push(...pageItems);

      // A short page means the window is exhausted.
      const last = pageItems.at(-1);
      if (!last || pageItems.length < SCHEDULE_PAGE_SIZE) break;

      cursorCreatedAt = last.createdAt;
      cursorId = last.id;

      // Reached the safety ceiling with a full final page: more rows may remain.
      if (page + 1 === SCHEDULE_MAX_PAGES) hasMore = true;
    }

    return apiJsonResponse({ data: items, meta: { hasMore } }, { requestId });
  } catch (error) {
    const safeError = error instanceof ApiProblem ? error : internalApiProblem();
    return apiProblemResponse(safeError, request, requestId);
  }
}
