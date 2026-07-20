import { createHmac, randomBytes, randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { resolveLocalSupabaseEnv, execLocalSql } from "./local-supabase-env";
import {
  encryptCredential,
  type CredentialContext,
} from "@/server/integrations/line/credentials";
import { FakeLineMessenger } from "@/server/integrations/line/client";
import {
  dispatchClaimedNotifications,
  type ClaimedNotification,
} from "@/server/notifications/gateway";
import { ingestWebhookEvents } from "@/server/integrations/line/webhook-gateway";

vi.setConfig({ testTimeout: 45000 });

// Shared seed fixtures (Wave A). Alpha active channel + a bound customer identity
// + a credential row; we overwrite the credential with a REAL AES-256-GCM envelope
// so the dispatch resolveTarget can decrypt the access token.
const ALPHA_ORG = "20000000-0000-4000-8000-000000000001";
const BETA_ORG = "20000000-0000-4000-8000-000000000002";
const ALPHA_OWNER = "10000000-0000-4000-8000-000000000001";
const BETA_OWNER = "10000000-0000-4000-8000-000000000005";
const ALPHA_CHANNEL = "a1c00000-0000-4000-8000-000000000001";
const ALPHA_IDENTITY = "a1de0000-0000-4000-8000-000000000001";
const KEY_VERSION = 1;

// A base64 32-byte master key for the test key ring (never a real production key).
const MASTER_KEY = randomBytes(32).toString("base64");
process.env.LINE_CREDENTIAL_MASTER_KEY_V1 = MASTER_KEY;

const env = resolveLocalSupabaseEnv();

const base64Url = (input: Buffer | string) =>
  Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function mintJwt(userId: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64Url(
    JSON.stringify({ role: "authenticated", sub: userId, iat: now, exp: now + 3600 }),
  );
  const signature = base64Url(createHmac("sha256", env.jwtSecret).update(`${header}.${payload}`).digest());
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

// Write a REAL encrypted access-token credential for Alpha's channel so a dispatch
// can decrypt it. The private schema is not exposed to PostgREST, so we seed via
// psql (the same superuser path the pgTAP fixtures use).
async function seedRealCredential(): Promise<string> {
  const accessTokenPlain = `test-access-token-${randomUUID()}`;
  const secretPlain = "test-channel-secret";
  const secretCtx: CredentialContext = {
    organizationId: ALPHA_ORG,
    lineChannelId: ALPHA_CHANNEL,
    credentialType: "secret",
  };
  const tokenCtx: CredentialContext = {
    organizationId: ALPHA_ORG,
    lineChannelId: ALPHA_CHANNEL,
    credentialType: "access_token",
  };
  const encSecret = encryptCredential(secretPlain, secretCtx, KEY_VERSION);
  const encToken = encryptCredential(accessTokenPlain, tokenCtx, KEY_VERSION);
  const hex = (b: Buffer) => `\\x${b.toString("hex")}`;

  execLocalSql(
    env.dbUrl,
    `update private.line_channel_credentials set ` +
      `secret_ciphertext = '${hex(encSecret.ciphertext)}', ` +
      `secret_nonce = '${hex(encSecret.nonce)}', ` +
      `access_token_ciphertext = '${hex(encToken.ciphertext)}', ` +
      `access_token_nonce = '${hex(encToken.nonce)}', ` +
      `key_version = ${KEY_VERSION} ` +
      `where line_channel_id = '${ALPHA_CHANNEL}';`,
  );
  return accessTokenPlain;
}

// A resolveTarget mirroring the worker route exactly: line_user_id + the token
// decrypted from the service-role secret-material RPC (no private-schema access).
function makeResolveTarget(admin: SupabaseClient) {
  return async (row: ClaimedNotification) => {
    if (!row.lineChannelId || !row.customerLineIdentityId) return null;
    const identity = await admin
      .schema("public")
      .from("customer_line_identities")
      .select("line_user_id")
      .eq("id", row.customerLineIdentityId)
      .maybeSingle();
    if (identity.error || !identity.data) return null;

    const material = await admin.rpc("get_line_channel_secret_material", {
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
    const decodeHex = (v: string) =>
      Buffer.from(v.startsWith("\\x") ? v.slice(2) : v, "hex");
    const { decryptCredential } = await import("@/server/integrations/line/credentials");
    const accessToken = decryptCredential(
      decodeHex(cred.accessTokenCiphertext),
      decodeHex(cred.accessTokenNonce),
      { organizationId: row.organizationId, lineChannelId: row.lineChannelId, credentialType: "access_token" },
      cred.keyVersion ?? 1,
    );
    return { to: (identity.data as { line_user_id: string }).line_user_id, accessToken };
  };
}

// Enqueue a fresh LINE notification bound to the seed identity for a scenario.
async function enqueueLineNotification(dedupeKey: string): Promise<string> {
  const admin = adminClient();
  const inserted = await admin
    .schema("public")
    .from("notifications")
    .insert({
      organization_id: ALPHA_ORG,
      channel: "line",
      line_channel_id: ALPHA_CHANNEL,
      customer_line_identity_id: ALPHA_IDENTITY,
      template_key: "completed",
      template_version: 1,
      payload: { workOrderNumber: "W-M6-0001" },
      status: "pending",
      approval_status: "not_required",
      dedupe_key: dedupeKey,
    })
    .select("id")
    .single();
  expect(inserted.error).toBeNull();
  return (inserted.data as { id: string }).id;
}

async function statusOf(id: string): Promise<{ status: string; attempt: number; nextAttemptAt: string | null }> {
  const admin = adminClient();
  const row = await admin
    .schema("public")
    .from("notifications")
    .select("status, attempt_count, next_attempt_at")
    .eq("id", id)
    .single();
  expect(row.error).toBeNull();
  const data = row.data as { status: string; attempt_count: number; next_attempt_at: string | null };
  return { status: data.status, attempt: data.attempt_count, nextAttemptAt: data.next_attempt_at };
}

beforeAll(async () => {
  await seedRealCredential();
});

describe("M6 LINE notifications (real local Supabase + FakeLineMessenger)", () => {
  it("驗章+重送: ingests a signed webhook batch and dedups a redelivery via the RPC", async () => {
    const admin = adminClient();
    const eventId = `m6-evt-${randomUUID()}`;
    const body = JSON.stringify({
      destination: "alpha-oa-channel-id",
      events: [
        { type: "follow", timestamp: Date.now(), webhookEventId: eventId, source: { userId: "Uline-alpha-customer-0001" } },
      ],
    });
    const rawBody = new TextEncoder().encode(body);

    const first = await ingestWebhookEvents({ supabase: admin, channelId: ALPHA_CHANNEL, rawBody });
    expect(first).toEqual({ ingested: 1, duplicate: 0 });

    // A byte-identical redelivery is a duplicate (primary event-id dedupe), not a new row.
    const replay = await ingestWebhookEvents({ supabase: admin, channelId: ALPHA_CHANNEL, rawBody });
    expect(replay).toEqual({ ingested: 0, duplicate: 1 });

    const rows = await admin
      .schema("public")
      .from("line_webhook_events")
      .select("id")
      .eq("line_channel_id", ALPHA_CHANNEL)
      .eq("webhook_event_id", eventId);
    expect(rows.error).toBeNull();
    expect(rows.data ?? []).toHaveLength(1);
  });

  it("dispatch success: a pending LINE notification is claimed, sent via the fake, and marked sent", async () => {
    const admin = adminClient();
    const id = await enqueueLineNotification(`m6-send-${randomUUID()}`);
    const messenger = new FakeLineMessenger({ mode: "sent" });

    const summary = await dispatchClaimedNotifications({
      supabase: admin,
      messenger,
      resolveTarget: makeResolveTarget(admin),
      workerId: `test-${randomUUID()}`,
      limit: 50,
    });

    expect(summary.sent).toBeGreaterThanOrEqual(1);
    expect(messenger.sent.length).toBeGreaterThanOrEqual(1);
    // The fake received the decrypted access token + the seed line_user_id.
    const delivered = messenger.sent.find((m) => m.to === "Uline-alpha-customer-0001");
    expect(delivered).toBeDefined();
    expect(delivered?.accessToken).toMatch(/^test-access-token-/);
    expect((await statusOf(id)).status).toBe("sent");
  });

  it("斷線 fallback: a retriable failure schedules a backoff, and repeated failures eventually terminate", async () => {
    const admin = adminClient();
    const id = await enqueueLineNotification(`m6-retry-${randomUUID()}`);
    const failing = new FakeLineMessenger({ mode: "server_error" });
    const resolveTarget = makeResolveTarget(admin);
    const workerId = `test-${randomUUID()}`;

    // First pass: claimed, fails (retriable) -> failed with a future next_attempt_at.
    await dispatchClaimedNotifications({ supabase: admin, messenger: failing, resolveTarget, workerId, limit: 50, now: new Date().toISOString() });
    let state = await statusOf(id);
    expect(state.status).toBe("failed");
    expect(state.attempt).toBe(1);
    expect(state.nextAttemptAt).not.toBeNull();

    // Drive it to exhaustion by claiming with now = far future (so backoff is due),
    // failing each time until attempt_count reaches max_attempts (5) -> terminal.
    for (let i = 0; i < 6; i += 1) {
      const future = new Date(Date.now() + (i + 1) * 3_600_000).toISOString();
      await dispatchClaimedNotifications({ supabase: admin, messenger: failing, resolveTarget, workerId, limit: 50, now: future });
      state = await statusOf(id);
      if (state.attempt >= 5) break;
    }
    expect(state.attempt).toBe(5);
    expect(state.status).toBe("failed");
    // Terminal: no further attempt scheduled.
    expect(state.nextAttemptAt).toBeNull();
  });

  it("permanent failure: a 4xx is not retried (terminal immediately)", async () => {
    const admin = adminClient();
    const id = await enqueueLineNotification(`m6-perm-${randomUUID()}`);
    const messenger = new FakeLineMessenger({ mode: "bad_request" });

    await dispatchClaimedNotifications({
      supabase: admin,
      messenger,
      resolveTarget: makeResolveTarget(admin),
      workerId: `test-${randomUUID()}`,
      limit: 50,
    });
    const state = await statusOf(id);
    expect(state.status).toBe("failed");
    expect(state.nextAttemptAt).toBeNull();
  });

  it("kill switch: a disabled channel's pending notifications are NOT claimed (outbound paused)", async () => {
    const admin = adminClient();
    const owner = memberClient(ALPHA_OWNER);
    const id = await enqueueLineNotification(`m6-kill-${randomUUID()}`);

    // Disable the channel via the staff RPC (owner gate internal).
    const disabled = await owner.rpc("disable_line_channel", {
      target_org: ALPHA_ORG,
      p_channel_id: ALPHA_CHANNEL,
      p_reason: "kill switch test",
    });
    expect(disabled.error).toBeNull();

    const messenger = new FakeLineMessenger({ mode: "sent" });
    const summary = await dispatchClaimedNotifications({
      supabase: admin,
      messenger,
      resolveTarget: makeResolveTarget(admin),
      workerId: `test-${randomUUID()}`,
      limit: 50,
    });
    // The disabled channel's row must not have been claimed/sent.
    expect(messenger.sent.some((m) => m.to === "Uline-alpha-customer-0001")).toBe(false);
    expect((await statusOf(id)).status).toBe("pending");
    void summary;

    // Re-enable for subsequent runs on a non-reset DB (verify RPC reactivates).
    const reactivated = await owner.rpc("verify_line_channel", {
      target_org: ALPHA_ORG,
      p_channel_id: ALPHA_CHANNEL,
    });
    expect(reactivated.error).toBeNull();
    // Clean up the parked notification so it does not send after re-enable.
    await admin.schema("public").from("notifications").update({ status: "cancelled" }).eq("id", id);
  });

  it("tenant isolation: list_notifications never returns another org's rows", async () => {
    const betaOwner = memberClient(BETA_OWNER);
    const alphaOnly = await enqueueLineNotification(`m6-tenant-${randomUUID()}`);

    // Beta owner lists Beta -> Alpha's row is absent.
    const betaList = await betaOwner.rpc("list_notifications", {
      target_org: BETA_ORG,
      p_status: null,
      p_channel: null,
      p_related_type: null,
      p_cursor_created_at: null,
      p_cursor_id: null,
      p_page_size: 100,
    });
    expect(betaList.error).toBeNull();
    const betaItems = (betaList.data as { items: Array<{ id: string }> }).items;
    expect(betaItems.some((i) => i.id === alphaOnly)).toBe(false);

    // Beta owner listing Alpha's org is forbidden (not a member).
    const crossTenant = await betaOwner.rpc("list_notifications", {
      target_org: ALPHA_ORG,
      p_status: null,
      p_channel: null,
      p_related_type: null,
      p_cursor_created_at: null,
      p_cursor_id: null,
      p_page_size: 100,
    });
    expect(crossTenant.error?.message).toContain("FORBIDDEN");

    const admin = adminClient();
    await admin.schema("public").from("notifications").update({ status: "cancelled" }).eq("id", alphaOnly);
  });
});
