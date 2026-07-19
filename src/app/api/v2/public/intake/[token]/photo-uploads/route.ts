import { publicPhotoUploadRequestSchema } from "@/schemas/public-intake";
import { parseJsonBody, resolveRequestId } from "@/server/api/request";
import { dataResponse, problemResponse } from "@/server/api/response";
import { createPublicIntakePhotoUpload } from "@/server/public-intake/gateway";
import { hashClientIp, hashPublicToken } from "@/server/public-intake/security";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ token: string }>;
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const requestId = resolveRequestId(request.headers.get("x-request-id"));
  const instance = new URL(request.url).pathname;

  try {
    const { token } = await context.params;
    const tokenHash = hashPublicToken(token);
    const input = await parseJsonBody(request, publicPhotoUploadRequestSchema, {
      maxBytes: 4 * 1024,
    });
    const pepper = process.env.PUBLIC_TOKEN_PEPPER ?? "";

    const instruction = await createPublicIntakePhotoUpload({
      tokenHash,
      clientIpHash: hashClientIp(request, pepper),
      ...input,
    });

    return dataResponse(instruction, { instance, requestId, status: 201 });
  } catch (error) {
    return problemResponse(error, { instance, requestId });
  }
}
