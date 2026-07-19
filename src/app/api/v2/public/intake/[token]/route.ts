import { randomUUID } from "node:crypto";

import { resolveRequestId } from "@/server/api/request";
import { dataResponse, problemResponse } from "@/server/api/response";
import { resolvePublicIntakeConfig } from "@/server/public-intake/gateway";
import { hashPublicToken } from "@/server/public-intake/security";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ token: string }>;
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const requestId = resolveRequestId(request.headers.get("x-request-id"));
  const instance = new URL(request.url).pathname;

  try {
    const { token } = await context.params;
    const configuration = await resolvePublicIntakeConfig(hashPublicToken(token));

    return dataResponse(
      {
        submissionId: randomUUID(),
        ...configuration,
      },
      { instance, requestId },
    );
  } catch (error) {
    return problemResponse(error, { instance, requestId });
  }
}
