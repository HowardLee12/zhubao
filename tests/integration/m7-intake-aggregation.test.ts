import { createHmac, randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { execLocalSql, resolveLocalSupabaseEnv } from "./local-supabase-env";
import { FakeAiExtractor } from "@/server/integrations/ai/extractor";
import { runClaimedExtractions } from "@/server/intake/gateway";

vi.setConfig({ testTimeout: 45000 });

// Reuse the M6 seed fixtures: Alpha's active channel + a bound customer identity.
const ALPHA_ORG = "20000000-0000-4000-8000-000000000001";
const ALPHA_OWNER = "10000000-0000-4000-8000-000000000001";
const ALPHA_CHANNEL = "a1c00000-0000-4000-8000-000000000001";
// Seed customer LINE identity bound to Alpha's channel (see supabase/seed.sql).
const ALPHA_IDENTITY = "a1de0000-0000-4000-8000-000000000001";
const ALPHA_IDENTITY_USER = "Uline-alpha-customer-0001";

const env = resolveLocalSupabaseEnv();

const base64Url = (input: Buffer | string) =>
  Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function mintJwt(userId: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64Url(
    JSON.stringify({ role: "authenticated", sub: userId, iat: now, exp: now + 3600 }),
  );
  const signature = base64Url(
    createHmac("sha256", env.jwtSecret).update(`${header}.${payload}`).digest(),
  );
  return `${header}.${payload}.${signature}`;
}

function memberClient(userId: string): SupabaseClient {
  return createClient(env.apiUrl, env.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${mintJwt(userId)}` } },
  });
}

function adminClient(): SupabaseClient {
  return createClient(env.apiUrl, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

const sha256Hex = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";

// Insert a claimed 'message' webhook event (as the M6 webhook edge would land it),
// then land it into a conversation via ingest_inbound_message — exactly what the
// gateway's ingestMessage seam does in the worker route.
async function ingestMessage(
  admin: SupabaseClient,
  lineUserId: string,
  text: string,
  customerLineIdentityId: string | null = null,
): Promise<{ conversationId: string; messageId: string }> {
  const lineMessageId = `m7-${randomUUID()}`;
  const inserted = await admin
    .schema("public")
    .from("line_webhook_events")
    .insert({
      organization_id: ALPHA_ORG,
      line_channel_id: ALPHA_CHANNEL,
      webhook_event_id: `m7-evt-${randomUUID()}`,
      event_type: "message",
      event_timestamp: new Date().toISOString(),
      payload: {
        type: "message",
        source: { type: "user", userId: lineUserId },
        message: { id: lineMessageId, type: "text", text },
      },
      payload_sha256: sha256Hex,
      status: "processing",
    })
    .select("id")
    .single();
  expect(inserted.error).toBeNull();
  const webhookEventId = (inserted.data as { id: string }).id;

  const result = await admin.rpc("ingest_inbound_message", {
    p_webhook_event_id: webhookEventId,
    p_line_message_id: lineMessageId,
    p_message_type: "text",
    p_text_content: text,
    p_raw: { type: "message", message: { id: lineMessageId, type: "text", text } },
    p_line_user_id: lineUserId,
    p_customer_line_identity_id: customerLineIdentityId,
  });
  expect(result.error).toBeNull();
  const data = result.data as { conversationId: string; messageId: string; duplicate: boolean };
  expect(data.duplicate).toBe(false);
  return { conversationId: data.conversationId, messageId: data.messageId };
}

// Intake tables REVOKE ALL from service_role; the staff read path is the RLS-scoped
// authenticated owner/admin/dispatcher client, so drafts are read that way here.
async function draftForConversation(reader: SupabaseClient, conversationId: string) {
  const row = await reader
    .schema("public")
    .from("intake_drafts")
    .select("id, origin, status, confidence, fields, summary, lock_version")
    .eq("conversation_id", conversationId)
    .eq("status", "pending_review")
    .maybeSingle();
  expect(row.error).toBeNull();
  return row.data as {
    id: string;
    origin: string;
    status: string;
    confidence: number | null;
    fields: Record<string, unknown>;
    summary: string | null;
    lock_version: number;
  } | null;
}

describe("M7 intake aggregation (real local Supabase + FakeAiExtractor)", () => {
  it("聚合+AI草稿: two messages from one sender aggregate into one conversation; Fake ok yields an AI draft", async () => {
    const admin = adminClient();
    // Use the seed's bound customer identity so the conversation carries a
    // customer_line_identity_id — confirm then builds a valid service_request (the
    // contact_method check is satisfied by the LINE identity). Clear any leftover
    // open conversation from a prior non-reset run so aggregation starts clean.
    execLocalSql(
      env.dbUrl,
      `update public.conversations set status = 'dismissed' ` +
        `where line_channel_id = '${ALPHA_CHANNEL}' and line_user_id = '${ALPHA_IDENTITY_USER}' and status = 'open';`,
    );
    const lineUserId = ALPHA_IDENTITY_USER;

    const first = await ingestMessage(admin, lineUserId, "冷氣不冷想約人來看", ALPHA_IDENTITY);
    const second = await ingestMessage(admin, lineUserId, "地址台北市大安區", ALPHA_IDENTITY);
    // One open conversation coalesces both messages.
    expect(second.conversationId).toBe(first.conversationId);

    const summary = await runClaimedExtractions({
      supabase: admin,
      extractor: new FakeAiExtractor({ mode: "ok" }),
      workerId: `test-${randomUUID()}`,
      limit: 50,
    });
    expect(summary.succeeded).toBeGreaterThanOrEqual(1);

    const owner = memberClient(ALPHA_OWNER);
    const draft = await draftForConversation(owner, first.conversationId);
    expect(draft).not.toBeNull();
    expect(draft?.origin).toBe("ai");
    expect(draft?.confidence).toBeGreaterThan(0);
    expect(draft?.fields.subject).toBeDefined();

    // A human confirms — the ONLY path to a service_request (no auto-convert).
    const confirmed = await owner.rpc("confirm_intake_draft", {
      target_org: ALPHA_ORG,
      target_draft: draft!.id,
      expected_lock_version: draft!.lock_version,
      target_idempotency_key: `m7-confirm-${randomUUID()}`,
      p_field_overrides: null,
    });
    expect(confirmed.error).toBeNull();
    const env1 = confirmed.data as { serviceRequestId: string; replayed: boolean };
    expect(env1.replayed).toBe(false);

    // The created service_request is source='line'.
    const sr = await admin
      .schema("public")
      .from("service_requests")
      .select("source")
      .eq("id", env1.serviceRequestId)
      .single();
    expect(sr.error).toBeNull();
    expect((sr.data as { source: string }).source).toBe("line");

    // confirm-once: a replay returns the SAME service_request.
    const replay = await owner.rpc("confirm_intake_draft", {
      target_org: ALPHA_ORG,
      target_draft: draft!.id,
      expected_lock_version: draft!.lock_version,
      target_idempotency_key: `m7-confirm-${randomUUID()}`,
      p_field_overrides: null,
    });
    expect(replay.error).toBeNull();
    const env2 = replay.data as { serviceRequestId: string; replayed: boolean };
    expect(env2.serviceRequestId).toBe(env1.serviceRequestId);
    expect(env2.replayed).toBe(true);
  });

  it("降級: an unavailable extractor still leaves a manual draft (intake never blocked)", async () => {
    const admin = adminClient();
    const lineUserId = `Uline-m7-degraded-${randomUUID()}`;
    const { conversationId } = await ingestMessage(admin, lineUserId, "馬桶漏水");

    const summary = await runClaimedExtractions({
      supabase: admin,
      extractor: new FakeAiExtractor({ mode: "unavailable" }),
      workerId: `test-${randomUUID()}`,
      limit: 50,
    });
    expect(summary.degraded).toBeGreaterThanOrEqual(1);

    const owner = memberClient(ALPHA_OWNER);
    const draft = await draftForConversation(owner, conversationId);
    expect(draft).not.toBeNull();
    // The message is preserved as a manual draft with no AI summary.
    expect(draft?.origin).toBe("manual");
    expect(draft?.summary).toBeNull();

    // A failed run is recorded for audit.
    const runs = await owner
      .schema("public")
      .from("intake_extraction_runs")
      .select("status")
      .eq("conversation_id", conversationId);
    expect(runs.error).toBeNull();
    expect((runs.data as Array<{ status: string }>).some((r) => r.status === "failed")).toBe(true);
  });

  it("降級-timeout: a timeout also degrades to a manual draft", async () => {
    const admin = adminClient();
    const lineUserId = `Uline-m7-timeout-${randomUUID()}`;
    const { conversationId } = await ingestMessage(admin, lineUserId, "電燈不亮");

    await runClaimedExtractions({
      supabase: admin,
      extractor: new FakeAiExtractor({ mode: "timeout" }),
      workerId: `test-${randomUUID()}`,
      limit: 50,
    });

    const draft = await draftForConversation(memberClient(ALPHA_OWNER), conversationId);
    expect(draft?.origin).toBe("manual");
  });

  it("聚合防呆: a duplicate LINE message id does not create a second inbound row", async () => {
    const admin = adminClient();
    const lineUserId = `Uline-m7-dedup-${randomUUID()}`;
    const lineMessageId = `m7-dup-${randomUUID()}`;

    const insertEvent = async () => {
      const inserted = await admin
        .schema("public")
        .from("line_webhook_events")
        .insert({
          organization_id: ALPHA_ORG,
          line_channel_id: ALPHA_CHANNEL,
          webhook_event_id: `m7-dup-evt-${randomUUID()}`,
          event_type: "message",
          event_timestamp: new Date().toISOString(),
          payload: { type: "message", message: { id: lineMessageId, type: "text", text: "hi" } },
          payload_sha256: sha256Hex,
          status: "processing",
        })
        .select("id")
        .single();
      expect(inserted.error).toBeNull();
      return (inserted.data as { id: string }).id;
    };

    const call = async (eventId: string) =>
      admin.rpc("ingest_inbound_message", {
        p_webhook_event_id: eventId,
        p_line_message_id: lineMessageId,
        p_message_type: "text",
        p_text_content: "hi",
        p_raw: { type: "message" },
        p_line_user_id: lineUserId,
      });

    const first = await call(await insertEvent());
    expect(first.error).toBeNull();
    expect((first.data as { duplicate: boolean }).duplicate).toBe(false);

    const second = await call(await insertEvent());
    expect(second.error).toBeNull();
    expect((second.data as { duplicate: boolean }).duplicate).toBe(true);
  });
});
