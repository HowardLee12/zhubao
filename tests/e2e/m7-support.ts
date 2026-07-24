import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, type APIRequestContext } from "@playwright/test";

/**
 * M7 E2E plumbing: seed a LINE conversation for a freshly-onboarded org, then drive
 * the real intake-extraction worker (Fake AI locally) to produce a draft — exactly
 * the aggregate → extract path the app runs in production, minus the real LINE
 * channel and real Fireworks call (both deferred seams).
 *
 * Seeding uses the service-role client (the same one the worker/webhook edges use);
 * ingest_inbound_message is service-role-only, mirroring integration coverage. The
 * degradation case seeds the manual-draft end state the gateway persists when the AI
 * throws, since the worker route always selects the Fake OK extractor locally.
 */

const WORKER_SECRET =
  process.env.WORKER_SECRET ?? "renoly-local-worker-secret-2026-not-production";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`M7 E2E requires ${name} in the environment.`);
  return value;
}

export function serviceRoleClient(): SupabaseClient {
  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const key = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

const SHA256_HEX = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";

export async function resolveOrganizationId(
  admin: SupabaseClient,
  slug: string,
): Promise<string> {
  const result = await admin
    .schema("public")
    .from("organizations")
    .select("id")
    .eq("slug", slug)
    .single();
  if (result.error) throw new Error(`Cannot resolve org for slug ${slug}: ${result.error.message}`);
  return (result.data as { id: string }).id;
}

// Create an active LINE channel + a bound customer identity for the org so a
// confirmed draft can build a valid service_request (its contact method is the
// LINE identity, not a phone). Returns the ids the conversation will reference.
export async function seedLineChannel(
  admin: SupabaseClient,
  organizationId: string,
): Promise<{ channelId: string; identityId: string; lineUserId: string }> {
  const suffix = randomUUID().slice(0, 8);
  const channel = await admin
    .schema("public")
    .from("line_channels")
    .insert({
      organization_id: organizationId,
      name: `E2E OA ${suffix}`,
      channel_id: `e2e-m7-${suffix}`,
      basic_id: `@e2e-${suffix}`,
      status: "active",
    })
    .select("id")
    .single();
  expect(channel.error, channel.error?.message).toBeNull();
  const channelId = (channel.data as { id: string }).id;

  const customer = await admin
    .schema("public")
    .from("customers")
    .insert({
      organization_id: organizationId,
      customer_no: `C-E2E-${suffix}`,
      kind: "individual",
      name: "E2E LINE 客戶",
      source: "line",
    })
    .select("id")
    .single();
  expect(customer.error, customer.error?.message).toBeNull();
  const customerId = (customer.data as { id: string }).id;

  const lineUserId = `Uline-e2e-${suffix}`;
  const identity = await admin
    .schema("public")
    .from("customer_line_identities")
    .insert({
      organization_id: organizationId,
      customer_id: customerId,
      line_channel_id: channelId,
      line_user_id: lineUserId,
      display_name: "E2E LINE 客戶",
      friend_status: "friend",
    })
    .select("id")
    .single();
  expect(identity.error, identity.error?.message).toBeNull();
  const identityId = (identity.data as { id: string }).id;

  return { channelId, identityId, lineUserId };
}

// Land one 'message' webhook event (as the M6 edge would) then aggregate it into
// the org's open conversation via ingest_inbound_message — the same seam the worker
// route drives. Sequential calls from one sender coalesce into one conversation.
export async function ingestLineMessage(
  admin: SupabaseClient,
  params: {
    organizationId: string;
    channelId: string;
    lineUserId: string;
    text: string;
    identityId?: string | null;
    messageType?: "text" | "image";
  },
): Promise<{ conversationId: string; messageId: string }> {
  const lineMessageId = `m7-${randomUUID()}`;
  const event = await admin
    .schema("public")
    .from("line_webhook_events")
    .insert({
      organization_id: params.organizationId,
      line_channel_id: params.channelId,
      webhook_event_id: `m7-evt-${randomUUID()}`,
      event_type: "message",
      event_timestamp: new Date().toISOString(),
      payload: {
        type: "message",
        source: { type: "user", userId: params.lineUserId },
        message: { id: lineMessageId, type: params.messageType ?? "text", text: params.text },
      },
      payload_sha256: SHA256_HEX,
      status: "processing",
    })
    .select("id")
    .single();
  expect(event.error, event.error?.message).toBeNull();

  const result = await admin.rpc("ingest_inbound_message", {
    p_webhook_event_id: (event.data as { id: string }).id,
    p_line_message_id: lineMessageId,
    p_message_type: params.messageType ?? "text",
    p_text_content: params.text,
    p_raw: { type: "message", message: { id: lineMessageId, text: params.text } },
    p_line_user_id: params.lineUserId,
    p_customer_line_identity_id: params.identityId ?? null,
  });
  expect(result.error, result.error?.message).toBeNull();
  const data = result.data as { conversationId: string; messageId: string };
  return { conversationId: data.conversationId, messageId: data.messageId };
}

// Drive the real intake-extraction worker route (Fake AI OK locally) so open
// conversations with no active draft get an AI draft — the honest aggregate→extract
// pass, authorized only by the shared WORKER_SECRET.
export async function runIntakeExtractionWorker(request: APIRequestContext): Promise<void> {
  const response = await request.post("/api/v2/internal/workers/intake-extraction", {
    headers: {
      Authorization: `Bearer ${WORKER_SECRET}`,
      "Content-Type": "application/json",
    },
    data: { limit: 50 },
  });
  expect(response.ok(), `worker returned ${response.status()}`).toBeTruthy();
}

// Seed the MANUAL-draft end state the gateway persists when the AI extractor throws
// (unavailable/timeout/bad output). This drives the REAL degradation RPC
// mark_extraction_failed — the same one the gateway's try/catch calls — so the
// original messages are preserved, a failed run is recorded for audit, and a
// confirmable manual draft exists. The intake tables REVOKE ALL direct access even
// from service_role; only these security-definer RPCs may write them, so this is the
// only correct way to reach the degraded state (a direct insert would be denied).
export async function seedDegradedManualDraft(
  admin: SupabaseClient,
  params: { organizationId: string; conversationId: string },
): Promise<void> {
  const result = await admin.rpc("mark_extraction_failed", {
    p_org: params.organizationId,
    p_conversation_id: params.conversationId,
    p_extractor_name: "fake",
    p_input_message_ids: [],
    p_error_code: "extractor_unavailable",
    p_latency_ms: 5,
  });
  expect(result.error, result.error?.message).toBeNull();
}
