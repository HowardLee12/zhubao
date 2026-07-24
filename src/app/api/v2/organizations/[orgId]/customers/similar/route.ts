import { z } from "zod";

import { similarCustomerRpcSchema, toSimilarCustomer } from "@/schemas/customer";
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

const similarQuerySchema = z
  .object({
    phone: z
      .string()
      .trim()
      .min(1)
      .max(40)
      .optional(),
    name: z.string().trim().min(1).max(200).optional(),
    limit: z.coerce.number().int().min(1).max(25).default(5),
  })
  .strict()
  .refine((value) => value.phone !== undefined || value.name !== undefined, {
    message: "至少需要提供電話或姓名其中一項。",
  });

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
    const parsedQuery = similarQuerySchema.safeParse({
      phone: url.searchParams.get("phone") ?? undefined,
      name: url.searchParams.get("name") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
    });
    if (!parsedQuery.success) throw ApiProblem.fromZod(parsedQuery.error);
    const { phone, name, limit } = parsedQuery.data;

    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) throw authenticationRequiredProblem();

    const { data, error } = await supabase.rpc("find_similar_customers", {
      target_org: parsedOrgId.data,
      p_phone: phone ?? null,
      p_name: name ?? null,
      p_limit: limit,
    });
    if (error) throw mapServiceRequestRpcError(error);

    const rows = z.array(similarCustomerRpcSchema).safeParse(data ?? []);
    if (!rows.success) throw internalApiProblem();

    return apiJsonResponse({ data: rows.data.map(toSimilarCustomer) }, { requestId });
  } catch (error) {
    const safeError = error instanceof ApiProblem ? error : internalApiProblem();
    return apiProblemResponse(safeError, request, requestId);
  }
}
