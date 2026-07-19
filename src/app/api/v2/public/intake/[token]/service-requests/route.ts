import { publicServiceRequestRequestSchema } from "@/schemas/public-intake";
import { parseIdempotencyKey } from "@/server/api/headers";
import { parseJsonBody, resolveRequestId } from "@/server/api/request";
import { dataResponse, problemResponse } from "@/server/api/response";
import { submitPublicServiceRequest } from "@/server/public-intake/gateway";
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
    const idempotencyKey = parseIdempotencyKey(request.headers.get("idempotency-key"));
    const input = await parseJsonBody(request, publicServiceRequestRequestSchema, {
      maxBytes: 64 * 1024,
    });
    const pepper = process.env.PUBLIC_TOKEN_PEPPER ?? "";

    const receipt = await submitPublicServiceRequest({
      tokenHash,
      submissionId: input.submissionId,
      idempotencyKey,
      clientIpHash: hashClientIp(request, pepper),
      requestBody: {
        serviceCatalogItemId: input.serviceCatalogItemId,
        contactName: input.contactName,
        contactPhone: input.contactPhone,
        subject: input.title,
        description: input.description,
        address: input.address,
        preferredWindows: input.preferredWindows,
      },
      photoIds: input.photoIds,
    });

    return dataResponse(receipt, { instance, requestId, status: 202 });
  } catch (error) {
    return problemResponse(error, { instance, requestId });
  }
}
