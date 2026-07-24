import { z } from "zod";

import { decodeKeysetCursor, encodeKeysetCursor } from "@/schemas/keyset-cursor";
import { workOrderCreateSchema } from "@/schemas/work-order-create";
import { workOrderDetailSchema, toClientWorkOrderDetail } from "@/schemas/work-order-detail";
import { workOrderListQuerySchema } from "@/schemas/work-order-list";
import { configuredAppOrigin, verifyCsrf } from "@/server/api/csrf";
import { requireStaffIdempotencyKey } from "@/server/api/headers";
import { ApiProblem } from "@/server/api/problem";
import { parseJsonBody, resolveRequestId } from "@/server/api/request";
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

const listItemSchema = z
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

const listResultSchema = z
  .object({ organizationId: z.uuid(), items: z.array(listItemSchema) })
  .strict();

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
    const rawQuery = Object.fromEntries(url.searchParams.entries());
    const parsedQuery = workOrderListQuerySchema.safeParse(rawQuery);
    if (!parsedQuery.success) throw ApiProblem.fromZod(parsedQuery.error);
    const { pageSize, cursor, ...filters } = parsedQuery.data;

    let cursorCreatedAt: string | null = null;
    let cursorId: string | null = null;
    if (cursor) {
      try {
        const position = decodeKeysetCursor(cursor);
        cursorCreatedAt = position.createdAt;
        cursorId = position.id;
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

    const { data, error } = await supabase.rpc("list_work_orders", {
      target_org: parsedOrgId.data,
      p_filters: filters,
      p_cursor_created_at: cursorCreatedAt,
      p_cursor_id: cursorId,
      p_page_size: pageSize,
    });
    if (error) throw mapWorkOrderRpcError(error);

    const result = listResultSchema.safeParse(data);
    if (!result.success) throw internalApiProblem();

    const hasMore = result.data.items.length === pageSize;
    const last = result.data.items.at(-1);
    const nextCursor =
      hasMore && last
        ? encodeKeysetCursor({ createdAt: last.createdAt, id: last.id })
        : null;

    return apiJsonResponse(
      { data: result.data.items, meta: { hasMore, nextCursor } },
      { requestId },
    );
  } catch (error) {
    const safeError = error instanceof ApiProblem ? error : internalApiProblem();
    return apiProblemResponse(safeError, request, requestId);
  }
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const requestId = resolveRequestId(request.headers.get("x-request-id"));

  try {
    verifyCsrf(request, configuredAppOrigin(request));
    const idempotencyKey = requireStaffIdempotencyKey(request.headers.get("idempotency-key"));

    const { orgId: rawOrgId } = await context.params;
    const parsedOrgId = z.uuid().safeParse(rawOrgId);
    if (!parsedOrgId.success) throw ApiProblem.fromZod(parsedOrgId.error);

    const body = await parseJsonBody(request, workOrderCreateSchema);

    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) throw authenticationRequiredProblem();

    const { data, error } = await supabase.rpc("create_work_order", {
      target_org: parsedOrgId.data,
      p_payload: body,
      p_idempotency_key: idempotencyKey,
      p_request_id: requestId,
    });
    if (error) throw mapWorkOrderRpcError(error);

    const detail = workOrderDetailSchema.safeParse(data);
    if (!detail.success) throw internalApiProblem();

    const replayed = detail.data.replayed === true;
    return apiJsonResponse(
      { data: toClientWorkOrderDetail(detail.data) },
      {
        status: replayed ? 200 : 201,
        requestId,
        headers: {
          etag: `"${detail.data.lockVersion}"`,
          location: `/api/v2/organizations/${parsedOrgId.data}/work-orders/${detail.data.id}`,
        },
      },
    );
  } catch (error) {
    const safeError = error instanceof ApiProblem ? error : internalApiProblem();
    return apiProblemResponse(safeError, request, requestId);
  }
}
