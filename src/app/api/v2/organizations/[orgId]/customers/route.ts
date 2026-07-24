import { z } from "zod";

import {
  createPilotCustomerSchema,
  customerRowSchema,
  toCustomerDto,
} from "@/schemas/customer";
import { authorizeOrgManager } from "@/server/api/org-authorization";
import { configuredAppOrigin, verifyCsrf } from "@/server/api/csrf";
import { ApiProblem } from "@/server/api/problem";
import { parseJsonBody, resolveRequestId } from "@/server/api/request";
import { mapServiceRequestRpcError } from "@/server/api/service-request-errors";
import {
  apiJsonResponse,
  apiProblemResponse,
  internalApiProblem,
} from "@/server/supabase/http";
import { createSupabaseServerClient } from "@/server/supabase/server";

export const dynamic = "force-dynamic";

const MAX_PAGE_SIZE = 50;

const customerQuerySchema = z
  .object({
    q: z.string().trim().min(1).max(120).optional(),
    limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(20),
  })
  .strict();

interface RouteContext {
  params: Promise<{ orgId: string }>;
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const requestId = resolveRequestId(request.headers.get("x-request-id"));

  try {
    const { orgId: rawOrgId } = await context.params;
    const parsedOrgId = z.uuid().safeParse(rawOrgId);
    if (!parsedOrgId.success) throw ApiProblem.fromZod(parsedOrgId.error);

    const url = new URL(request.url);
    const parsedQuery = customerQuerySchema.safeParse({
      q: url.searchParams.get("q") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
    });
    if (!parsedQuery.success) throw ApiProblem.fromZod(parsedQuery.error);
    const { q, limit } = parsedQuery.data;

    const supabase = await createSupabaseServerClient();
    await authorizeOrgManager(supabase, parsedOrgId.data);

    const { data, error } = await supabase.rpc("list_pilot_customers", {
      p_organization_id: parsedOrgId.data,
      p_query: q ?? null,
      p_limit: limit,
    });
    if (error) throw mapServiceRequestRpcError(error);

    const rows = z.array(customerRowSchema).safeParse(data ?? []);
    if (!rows.success) throw internalApiProblem();

    return apiJsonResponse({ data: rows.data.map((row) => toCustomerDto(row)) }, { requestId });
  } catch (error) {
    const safeError = error instanceof ApiProblem ? error : internalApiProblem();
    return apiProblemResponse(safeError, request, requestId);
  }
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const requestId = resolveRequestId(request.headers.get("x-request-id"));

  try {
    verifyCsrf(request, configuredAppOrigin(request));

    const { orgId: rawOrgId } = await context.params;
    const parsedOrgId = z.uuid().safeParse(rawOrgId);
    if (!parsedOrgId.success) throw ApiProblem.fromZod(parsedOrgId.error);
    const body = await parseJsonBody(request, createPilotCustomerSchema, { maxBytes: 4096 });

    const supabase = await createSupabaseServerClient();
    await authorizeOrgManager(supabase, parsedOrgId.data);

    const { data, error } = await supabase.rpc("create_pilot_customer", {
      p_organization_id: parsedOrgId.data,
      p_name: body.name,
      p_phone: body.phone,
    });
    if (error) throw mapServiceRequestRpcError(error);

    const row = customerRowSchema.safeParse(data);
    if (!row.success) throw internalApiProblem();
    const dto = toCustomerDto(row.data);

    return apiJsonResponse(
      { data: dto },
      {
        status: 201,
        requestId,
      },
    );
  } catch (error) {
    const safeError = error instanceof ApiProblem ? error : internalApiProblem();
    return apiProblemResponse(safeError, request, requestId);
  }
}
