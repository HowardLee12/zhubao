import { randomUUID } from "node:crypto";

import { z } from "zod";

import { lineChannelConnectSchema, lineChannelViewSchema } from "@/schemas/line-channel";
import { configuredAppOrigin, verifyCsrf } from "@/server/api/csrf";
import { resolveStaffIdempotencyKey } from "@/server/api/headers";
import { ApiProblem } from "@/server/api/problem";
import { parseJsonBody, resolveRequestId } from "@/server/api/request";
import { mapLineChannelRpcError } from "@/server/api/line-channel-errors";
import {
  encryptCredential,
  type CredentialContext,
} from "@/server/integrations/line/credentials";
import {
  apiJsonResponse,
  apiProblemResponse,
  authenticationRequiredProblem,
  internalApiProblem,
} from "@/server/supabase/http";
import { createSupabaseServerClient } from "@/server/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ orgId: string }>;
}

const listResultSchema = z
  .object({ organizationId: z.uuid(), items: z.array(lineChannelViewSchema) })
  .strict();

// The active key version the app encrypts with. Rotating this to V2 (writing a new
// LINE_CREDENTIAL_MASTER_KEY_V2, keeping V1 to decrypt legacy rows) is a config-only
// change; connect always encrypts with the current version.
const ACTIVE_KEY_VERSION = 1;

// Postgres bytea literal for a Buffer, so the RPC receives real binary. PostgREST
// accepts the "\\x<hex>" escaped form for a bytea parameter.
function toByteaLiteral(buffer: Buffer): string {
  return `\\x${buffer.toString("hex")}`;
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const requestId = resolveRequestId(request.headers.get("x-request-id"));

  try {
    const { orgId: rawOrgId } = await context.params;
    const parsedOrgId = z.uuid().safeParse(rawOrgId);
    if (!parsedOrgId.success) throw ApiProblem.fromZod(parsedOrgId.error);

    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) throw authenticationRequiredProblem();

    const { data, error } = await supabase.rpc("list_line_channels", {
      target_org: parsedOrgId.data,
    });
    if (error) throw mapLineChannelRpcError(error);

    const result = listResultSchema.safeParse(data);
    if (!result.success) throw internalApiProblem();

    return apiJsonResponse({ data: result.data.items }, { requestId });
  } catch (error) {
    const safeError = error instanceof ApiProblem ? error : internalApiProblem();
    return apiProblemResponse(safeError, request, requestId);
  }
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const requestId = resolveRequestId(request.headers.get("x-request-id"));

  try {
    verifyCsrf(request, configuredAppOrigin(request));
    resolveStaffIdempotencyKey(request.headers.get("idempotency-key"));

    const { orgId: rawOrgId } = await context.params;
    const parsedOrgId = z.uuid().safeParse(rawOrgId);
    if (!parsedOrgId.success) throw ApiProblem.fromZod(parsedOrgId.error);
    const orgId = parsedOrgId.data;

    const body = await parseJsonBody(request, lineChannelConnectSchema);

    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) throw authenticationRequiredProblem();

    // Reuse the org's existing channel id (if any) so the AAD binds to a stable id
    // and we keep one channel per org; otherwise mint a fresh id for the new row.
    const existing = await supabase.rpc("list_line_channels", { target_org: orgId });
    if (existing.error) throw mapLineChannelRpcError(existing.error);
    const existingItems = listResultSchema.safeParse(existing.data);
    const channelRowId = existingItems.success && existingItems.data.items[0]
      ? existingItems.data.items[0].id
      : randomUUID();

    // Encrypt secret + token server-side, AAD-bound to (org, channel, type, keyVer).
    // The plaintext NEVER leaves this function; only ciphertext reaches the RPC.
    const secretContext: CredentialContext = {
      organizationId: orgId,
      lineChannelId: channelRowId,
      credentialType: "secret",
    };
    const tokenContext: CredentialContext = {
      organizationId: orgId,
      lineChannelId: channelRowId,
      credentialType: "access_token",
    };
    const encSecret = encryptCredential(body.channelSecret, secretContext, ACTIVE_KEY_VERSION);
    const encToken = encryptCredential(body.accessToken, tokenContext, ACTIVE_KEY_VERSION);

    const { data, error } = await supabase.rpc("connect_line_channel", {
      target_org: orgId,
      p_channel_row_id: channelRowId,
      p_name: body.name,
      p_channel_id: body.channelId,
      p_basic_id: body.basicId ?? null,
      p_liff_id: body.liffId ?? null,
      p_secret_ciphertext: toByteaLiteral(encSecret.ciphertext),
      p_secret_nonce: toByteaLiteral(encSecret.nonce),
      p_access_token_ciphertext: toByteaLiteral(encToken.ciphertext),
      p_access_token_nonce: toByteaLiteral(encToken.nonce),
      p_key_version: ACTIVE_KEY_VERSION,
      p_token_expires_at: body.tokenExpiresAt ?? null,
    });
    if (error) throw mapLineChannelRpcError(error);

    // The RPC returns only { id, status, credentialConfigured } — never ciphertext.
    return apiJsonResponse({ data }, { status: 200, requestId });
  } catch (error) {
    const safeError = error instanceof ApiProblem ? error : internalApiProblem();
    return apiProblemResponse(safeError, request, requestId);
  }
}
