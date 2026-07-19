import { z } from "zod";

import { publicPhotoCompleteRequestSchema } from "@/schemas/public-intake";
import { parseIdempotencyKey } from "@/server/api/headers";
import { ApiProblem } from "@/server/api/problem";
import { parseJsonBody, resolveRequestId } from "@/server/api/request";
import { dataResponse, problemResponse } from "@/server/api/response";
import { completePublicIntakePhotoUpload } from "@/server/public-intake/gateway";
import { hashPublicToken } from "@/server/public-intake/security";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ token: string; photoId: string }>;
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const requestId = resolveRequestId(request.headers.get("x-request-id"));
  const instance = new URL(request.url).pathname;

  try {
    const { token, photoId: rawPhotoId } = await context.params;
    const parsedPhotoId = z.uuid().safeParse(rawPhotoId);
    if (!parsedPhotoId.success) {
      throw ApiProblem.fromZod(parsedPhotoId.error);
    }

    const input = await parseJsonBody(request, publicPhotoCompleteRequestSchema, {
      maxBytes: 1024,
    });
    const idempotencyKey = parseIdempotencyKey(request.headers.get("idempotency-key"));
    const result = await completePublicIntakePhotoUpload({
      tokenHash: hashPublicToken(token),
      submissionId: input.submissionId,
      photoId: parsedPhotoId.data,
      idempotencyKey,
    });

    return dataResponse(result, { instance, requestId, status: 202 });
  } catch (error) {
    return problemResponse(error, { instance, requestId });
  }
}
