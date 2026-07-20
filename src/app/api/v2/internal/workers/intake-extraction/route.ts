import { z } from "zod";

import { ApiProblem } from "@/server/api/problem";
import { resolveRequestId } from "@/server/api/request";
import { assertWorkerAuthorized } from "@/server/api/worker-auth";
import { createAiExtractor } from "@/server/integrations/ai/factory";
import { runClaimedExtractions } from "@/server/intake/gateway";
import { createAdminSupabaseClient } from "@/server/supabase/admin";
import { apiJsonResponse, apiProblemResponse, internalApiProblem } from "@/server/supabase/http";

// Internal intake-extraction worker. Guarded ONLY by the shared WORKER_SECRET (no
// staff session) — auth is checked FIRST, before the body is parsed. One pass: claim
// open conversations with no active draft, run each through the factory-selected
// AiExtractor (Fake locally, Fireworks once wired), and let the gateway map the
// outcome to the DB. AI failure degrades to a manual draft in the gateway — it never
// blocks intake and never fails the worker.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({ limit: z.number().int().min(1).max(50).optional() }).strict();

export async function POST(request: Request): Promise<Response> {
  const requestId = resolveRequestId(request.headers.get("x-request-id"));

  try {
    assertWorkerAuthorized(request);

    let limit: number | undefined;
    const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
    if (contentType.startsWith("application/json")) {
      const raw = await request.text();
      if (raw.trim().length > 0) {
        const parsed = requestSchema.safeParse(JSON.parse(raw));
        if (!parsed.success) throw ApiProblem.fromZod(parsed.error);
        limit = parsed.data.limit;
      }
    }

    const supabase = createAdminSupabaseClient();
    const summary = await runClaimedExtractions({
      supabase,
      extractor: createAiExtractor(),
      workerId: `intake-extraction:${requestId}`,
      limit,
    });

    return apiJsonResponse({ data: summary }, { requestId });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return apiProblemResponse(
        new ApiProblem({
          status: 400,
          code: "MALFORMED_REQUEST",
          title: "要求格式錯誤",
          detail: "Request body must be valid JSON.",
        }),
        request,
        requestId,
      );
    }
    const safeError = error instanceof ApiProblem ? error : internalApiProblem();
    return apiProblemResponse(safeError, request, requestId);
  }
}
