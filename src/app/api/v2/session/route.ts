import { pilotSessionRpcResultSchema } from "@/schemas/organization";
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

export async function GET(request: Request): Promise<Response> {
  const requestId = resolveRequestId(request.headers.get("x-request-id"));

  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      throw authenticationRequiredProblem();
    }

    if (!user.email) {
      throw new ApiProblem({
        status: 403,
        code: "AUTH_EMAIL_REQUIRED",
        title: "需要電子郵件帳號",
        detail: "這個工作區需要以電子郵件帳號登入。",
      });
    }

    const { data, error } = await supabase.rpc("get_pilot_session");
    if (error) {
      throw internalApiProblem();
    }

    const session = pilotSessionRpcResultSchema.safeParse(data);
    if (!session.success) {
      throw internalApiProblem();
    }

    return apiJsonResponse(
      {
        data: {
          user: { id: user.id, email: user.email },
          ...session.data,
        },
      },
      { requestId },
    );
  } catch (error) {
    const safeError = error instanceof ApiProblem ? error : internalApiProblem();
    return apiProblemResponse(safeError, request, requestId);
  }
}
