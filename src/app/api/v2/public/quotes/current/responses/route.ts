import { publicQuoteResponseSchema } from "@/schemas/quote";
import { parseIdempotencyKey } from "@/server/api/headers";
import { parseJsonBody, resolveRequestId } from "@/server/api/request";
import { dataResponse, problemResponse } from "@/server/api/response";
import {
  authorizePublicQuoteRequest,
  respondToPublicQuote,
} from "@/server/quotes/gateway";
import {
  hashClientIp,
  hashPublicToken,
  requirePublicBearerToken,
} from "@/server/public-intake/security";

export const dynamic = "force-dynamic";

const INSTANCE = "/api/v2/public/quotes/current/responses";
const MAX_PUBLIC_QUOTE_RESPONSE_BYTES = 16 * 1024;

export async function POST(request: Request): Promise<Response> {
  const requestId = resolveRequestId(request.headers.get("x-request-id"));
  try {
    const token = requirePublicBearerToken(request);
    const access = await authorizePublicQuoteRequest({
      tokenHashHex: hashPublicToken(token),
      clientIpHashHex: hashClientIp(request, process.env.PUBLIC_TOKEN_PEPPER ?? ""),
      action: "respond",
    });
    const idempotencyKey = parseIdempotencyKey(request.headers.get("idempotency-key"));
    const payload = await parseJsonBody(request, publicQuoteResponseSchema, {
      maxBytes: MAX_PUBLIC_QUOTE_RESPONSE_BYTES,
    });
    const decision = await respondToPublicQuote({
      access,
      idempotencyKey,
      payload,
      requestId,
    });
    return dataResponse(decision, { instance: INSTANCE, requestId });
  } catch (error) {
    return problemResponse(error, { instance: INSTANCE, requestId });
  }
}
