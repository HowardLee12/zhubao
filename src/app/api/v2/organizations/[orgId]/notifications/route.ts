import { z } from "zod";

import { decodeKeysetCursor, encodeKeysetCursor } from "@/schemas/keyset-cursor";
import { notificationListQuerySchema, notificationViewSchema } from "@/schemas/notification";
import { ApiProblem } from "@/server/api/problem";
import { resolveRequestId } from "@/server/api/request";
import { mapNotificationRpcError } from "@/server/api/notification-errors";
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

const listResultSchema = z
  .object({
    organizationId: z.uuid(),
    items: z.array(notificationViewSchema),
  })
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
    const parsedQuery = notificationListQuerySchema.safeParse(rawQuery);
    if (!parsedQuery.success) throw ApiProblem.fromZod(parsedQuery.error);
    const { pageSize, cursor, status, channel, relatedType } = parsedQuery.data;
    const limit = pageSize ?? 20;

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

    const { data, error } = await supabase.rpc("list_notifications", {
      target_org: parsedOrgId.data,
      p_status: status ?? null,
      p_channel: channel ?? null,
      p_related_type: relatedType ?? null,
      p_cursor_created_at: cursorCreatedAt,
      p_cursor_id: cursorId,
      p_page_size: limit,
    });
    if (error) throw mapNotificationRpcError(error);

    const result = listResultSchema.safeParse(data);
    if (!result.success) throw internalApiProblem();

    const hasMore = result.data.items.length === limit;
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
