import { notificationDispatchRequestSchema } from "@/schemas/notification";
import { assertWorkerAuthorized } from "@/server/api/worker-auth";
import { createLineMessenger } from "@/server/integrations/line/client";
import {
  decryptCredential,
  type CredentialContext,
} from "@/server/integrations/line/credentials";
import {
  dispatchClaimedNotifications,
  type ClaimedNotification,
  type ResolveTarget,
} from "@/server/notifications/gateway";
import { createAdminSupabaseClient } from "@/server/supabase/admin";
import { ApiProblem } from "@/server/api/problem";
import { resolveRequestId } from "@/server/api/request";
import { apiJsonResponse, apiProblemResponse, internalApiProblem } from "@/server/supabase/http";

// Internal notification-dispatch worker. Guarded ONLY by the shared WORKER_SECRET
// (no staff session) — auth is checked FIRST, before the body is parsed. One pass:
// claim a batch, send each through the factory-selected messenger (Fake locally,
// Real once wired), and map the provider result to the outbox state machine.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function decodeHex(value: string): Buffer {
  return Buffer.from(value.startsWith(String.raw`\x`) ? value.slice(2) : value, "hex");
}

// Resolve a claimed row to its concrete LINE send target: the recipient's
// line_user_id and the channel's decrypted access token. Returns null (permanent
// fail — RECIPIENT_UNRESOLVED) when either the identity or the credential is
// missing, so an undeliverable row is not retried forever.
function makeResolveTarget(
  supabase: ReturnType<typeof createAdminSupabaseClient>,
): ResolveTarget {
  return async (row: ClaimedNotification) => {
    if (!row.lineChannelId || !row.customerLineIdentityId) return null;

    const identity = await supabase
      .schema("public")
      .from("customer_line_identities")
      .select("line_user_id")
      .eq("id", row.customerLineIdentityId)
      .maybeSingle();
    if (identity.error || !identity.data) return null;
    const to = (identity.data as { line_user_id: string }).line_user_id;

    // The private credentials schema is not exposed to PostgREST; the service-role
    // RPC returns the encrypted access-token material (hex) to decrypt in Node.
    const material = await supabase.rpc("get_line_channel_secret_material", {
      p_channel_id: row.lineChannelId,
    });
    if (material.error || !material.data) return null;
    const cred = material.data as {
      credentialConfigured: boolean;
      keyVersion?: number;
      accessTokenCiphertext?: string;
      accessTokenNonce?: string;
    };
    if (!cred.credentialConfigured || !cred.accessTokenCiphertext || !cred.accessTokenNonce) {
      return null;
    }

    const context: CredentialContext = {
      organizationId: row.organizationId,
      lineChannelId: row.lineChannelId,
      credentialType: "access_token",
    };

    try {
      const accessToken = decryptCredential(
        decodeHex(cred.accessTokenCiphertext),
        decodeHex(cred.accessTokenNonce),
        context,
        cred.keyVersion ?? 1,
      );
      return { to, accessToken };
    } catch {
      return null;
    }
  };
}

export async function POST(request: Request): Promise<Response> {
  const requestId = resolveRequestId(request.headers.get("x-request-id"));

  try {
    assertWorkerAuthorized(request);

    let limit: number | undefined;
    const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
    if (contentType.startsWith("application/json")) {
      const raw = await request.text();
      if (raw.trim().length > 0) {
        const parsed = notificationDispatchRequestSchema.safeParse(JSON.parse(raw));
        if (!parsed.success) throw ApiProblem.fromZod(parsed.error);
        limit = parsed.data.limit;
      }
    }

    const supabase = createAdminSupabaseClient();
    const summary = await dispatchClaimedNotifications({
      supabase,
      messenger: createLineMessenger(),
      resolveTarget: makeResolveTarget(supabase),
      workerId: `notification-dispatch:${requestId}`,
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
