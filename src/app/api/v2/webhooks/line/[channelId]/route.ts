import { z } from "zod";

import { resolveRequestId } from "@/server/api/request";
import {
  decryptCredential,
  type CredentialContext,
} from "@/server/integrations/line/credentials";
import { verifyLineSignature } from "@/server/integrations/line/signature";
import { ingestWebhookEvents } from "@/server/integrations/line/webhook-gateway";
import { createAdminSupabaseClient } from "@/server/supabase/admin";

// Public LINE webhook receiver. This is the inbound edge of the two dedupe gates
// (驗章 + 重送): it runs on the Node runtime (Web Crypto + service-role client),
// is force-dynamic, and takes NO cookie/CSRF path — LINE authenticates itself with
// the x-line-signature HMAC, which is the ONLY thing that gates ingestion.
//
// Order is load-bearing:
//   1. Read the EXACT raw bytes (arrayBuffer) before any parse — the signature is
//      over those bytes; re-serialized JSON would not match.
//   2. Cap at 1MB (LINE batches are small; anything larger is rejected as too large).
//   3. Resolve the channel's secret by decrypting private.line_channel_credentials
//      just-in-time (the plaintext never touches the client and is not logged).
//   4. verifyLineSignature -> 401 on any failure BEFORE ingest. A bad/absent
//      signature never lands a row.
//   5. ingest each event (insert-only, dedupe uniques). Duplicates are expected
//      (LINE retries) and still return 200 — only a signature failure is 401.
// Domain processing (friend-state, image download) is deferred to the worker; this
// route does no domain writes and downloads nothing inline, so it returns fast.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 1024 * 1024;

interface RouteContext {
  params: Promise<{ channelId: string }>;
}

function textResponse(status: number, body: Record<string, unknown>, requestId: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "private, no-store",
      "x-request-id": requestId,
    },
  });
}

// The secret-material RPC returns ciphertext/nonce as bare lowercase hex
// (encode(..., 'hex')); tolerate a leading "\x" too for safety.
function decodeHex(value: string): Buffer {
  return Buffer.from(value.startsWith(String.raw`\x`) ? value.slice(2) : value, "hex");
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const requestId = resolveRequestId(request.headers.get("x-request-id"));

  try {
    const { channelId: rawChannelId } = await context.params;
    const parsedChannelId = z.uuid().safeParse(rawChannelId);
    if (!parsedChannelId.success) {
      // An unroutable channel id is a client error, never a leak of channel state.
      return textResponse(404, { ok: false }, requestId);
    }
    const channelId = parsedChannelId.data;

    const declaredLength = request.headers.get("content-length");
    if (declaredLength && /^\d+$/.test(declaredLength) && Number(declaredLength) > MAX_BODY_BYTES) {
      return textResponse(413, { ok: false }, requestId);
    }

    const rawBuffer = await request.arrayBuffer();
    if (rawBuffer.byteLength > MAX_BODY_BYTES) {
      return textResponse(413, { ok: false }, requestId);
    }
    const rawBody = new Uint8Array(rawBuffer);

    const supabase = createAdminSupabaseClient();

    // Resolve the channel's encrypted secret via the service-role RPC (the private
    // schema is not exposed to PostgREST). A missing channel -> 404 that reveals
    // nothing; a channel without credentials -> 401 (nothing to verify against).
    const materialResult = await supabase.rpc("get_line_channel_secret_material", {
      p_channel_id: channelId,
    });
    if (materialResult.error) {
      const message = materialResult.error.message ?? "";
      if (message.includes("LINE_CHANNEL_NOT_FOUND")) {
        return textResponse(404, { ok: false }, requestId);
      }
      throw materialResult.error;
    }
    const material = materialResult.data as {
      organizationId: string;
      credentialConfigured: boolean;
      keyVersion?: number;
      secretCiphertext?: string;
      secretNonce?: string;
    } | null;
    if (!material || !material.credentialConfigured || !material.secretCiphertext || !material.secretNonce) {
      return textResponse(401, { ok: false }, requestId);
    }

    const credentialContext: CredentialContext = {
      organizationId: material.organizationId,
      lineChannelId: channelId,
      credentialType: "secret",
    };

    let secret: string;
    try {
      secret = decryptCredential(
        decodeHex(material.secretCiphertext),
        decodeHex(material.secretNonce),
        credentialContext,
        material.keyVersion ?? 1,
      );
    } catch {
      // A credential we cannot decrypt (key rotated out / tamper) fails closed.
      return textResponse(401, { ok: false }, requestId);
    }

    const signatureOk = verifyLineSignature(
      rawBody,
      request.headers.get("x-line-signature"),
      secret,
    );
    if (!signatureOk) {
      return textResponse(401, { ok: false }, requestId);
    }

    // Signature verified. Land each event (insert-only); duplicates are fine.
    await ingestWebhookEvents({ supabase, channelId, rawBody });

    return textResponse(200, { ok: true }, requestId);
  } catch {
    // Never leak internals to an unauthenticated caller; a processing failure is a
    // 500 with no detail. LINE will retry, and the dedupe uniques make that safe.
    return textResponse(500, { ok: false }, requestId);
  }
}
