import { resolveRequestId } from "@/server/api/request";
import { dataResponse, problemResponse } from "@/server/api/response";
import {
  authorizePublicQuoteRequest,
  resolvePublicQuote,
} from "@/server/quotes/gateway";
import {
  hashClientIp,
  hashPublicToken,
  requirePublicBearerToken,
} from "@/server/public-intake/security";

export const dynamic = "force-dynamic";

const INSTANCE = "/api/v2/public/quotes/current";

export async function GET(request: Request): Promise<Response> {
  const requestId = resolveRequestId(request.headers.get("x-request-id"));
  try {
    const token = requirePublicBearerToken(request);
    const access = await authorizePublicQuoteRequest({
      tokenHashHex: hashPublicToken(token),
      clientIpHashHex: hashClientIp(request, process.env.PUBLIC_TOKEN_PEPPER ?? ""),
      action: "view",
    });
    const quote = await resolvePublicQuote(access);
    return dataResponse(quote, { instance: INSTANCE, requestId });
  } catch (error) {
    return problemResponse(error, { instance: INSTANCE, requestId });
  }
}
