import { z } from "zod";

import { publicDecisionRecordSchema, publicQuoteSchema, type PublicQuoteResponse } from "@/schemas/quote";
import { ApiProblem } from "@/server/api/problem";
import { mapPublicQuoteRpcError } from "@/server/api/quote-errors";
import { internalApiProblem } from "@/server/supabase/http";
import { createAdminSupabaseClient } from "@/server/supabase/admin";

const publicRateStatusSchema = z.enum(["allowed", "invalid", "limited"]);
const publicQuoteAccessGrantBrand: unique symbol = Symbol("publicQuoteAccessGrant");

export interface PublicQuoteAccessGrant {
  readonly tokenHashHex: string;
  readonly action: "view" | "respond";
  readonly [publicQuoteAccessGrantBrand]: true;
}

function publicLinkUnavailable(): ApiProblem {
  return new ApiProblem({
    status: 404,
    code: "PUBLIC_LINK_NOT_FOUND",
    title: "連結無法使用",
    detail: "此連結不存在、已過期或已被撤銷。",
  });
}

function publicRateLimited(): ApiProblem {
  return new ApiProblem({
    status: 429,
    code: "RATE_LIMITED",
    title: "要求過於頻繁",
    detail: "操作次數過多，請稍後再試。",
  });
}

async function consumePublicQuoteBudget(
  client: ReturnType<typeof createAdminSupabaseClient>,
  command: { tokenHashHex: string; clientIpHashHex: string; action: "view" | "respond" },
): Promise<void> {
  const { data, error } = await client.rpc("consume_pilot_public_quote_rate_limit", {
    p_public_token_hash_hex: command.tokenHashHex,
    p_client_ip_hash_hex: command.clientIpHashHex,
    p_action: command.action,
  });
  if (error) throw mapPublicQuoteRpcError(error);
  const status = publicRateStatusSchema.safeParse(data);
  if (!status.success) throw internalApiProblem();
  if (status.data === "limited") throw publicRateLimited();
  if (status.data === "invalid") throw publicLinkUnavailable();
}

/**
 * Persist the shared IP/token rate-limit counters before a route reads a body.
 * The opaque grant makes it difficult for another caller to accidentally move
 * expensive parsing ahead of this boundary or consume the same request twice.
 */
export async function authorizePublicQuoteRequest(command: {
  tokenHashHex: string;
  clientIpHashHex: string;
  action: "view" | "respond";
}): Promise<PublicQuoteAccessGrant> {
  const client = createAdminSupabaseClient();
  await consumePublicQuoteBudget(client, command);
  return Object.freeze({
    tokenHashHex: command.tokenHashHex,
    action: command.action,
    [publicQuoteAccessGrantBrand]: true as const,
  });
}

function requireGrantAction(
  access: PublicQuoteAccessGrant,
  action: PublicQuoteAccessGrant["action"],
): void {
  if (
    !access ||
    access[publicQuoteAccessGrantBrand] !== true ||
    access.action !== action
  ) {
    throw internalApiProblem();
  }
}

export async function resolvePublicQuote(access: PublicQuoteAccessGrant) {
  requireGrantAction(access, "view");
  const client = createAdminSupabaseClient();
  const { data, error } = await client.rpc("resolve_pilot_public_quote", {
    p_public_token_hash_hex: access.tokenHashHex,
  });
  if (error) throw mapPublicQuoteRpcError(error);

  const parsed = publicQuoteSchema.safeParse(data);
  if (!parsed.success) throw internalApiProblem();
  return parsed.data;
}

export async function respondToPublicQuote(command: {
  access: PublicQuoteAccessGrant;
  idempotencyKey: string;
  payload: PublicQuoteResponse;
  requestId: string;
}) {
  requireGrantAction(command.access, "respond");
  const client = createAdminSupabaseClient();
  const { data, error } = await client.rpc("respond_pilot_public_quote", {
    p_public_token_hash_hex: command.access.tokenHashHex,
    p_idempotency_key: command.idempotencyKey,
    p_payload: command.payload,
    p_request_id: command.requestId,
  });
  if (error) throw mapPublicQuoteRpcError(error);

  const parsed = publicDecisionRecordSchema.safeParse(data);
  if (!parsed.success) throw internalApiProblem();
  return parsed.data;
}
