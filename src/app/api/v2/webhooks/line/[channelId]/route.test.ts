import { createHmac } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  createAdminSupabaseClient: vi.fn(),
  encryptCredential: vi.fn(),
  decryptCredential: vi.fn(),
  ingestWebhookEvents: vi.fn(),
}));

vi.mock("@/server/supabase/admin", () => ({
  createAdminSupabaseClient: mocks.createAdminSupabaseClient,
}));
vi.mock("@/server/integrations/line/credentials", () => ({
  decryptCredential: mocks.decryptCredential,
}));
vi.mock("@/server/integrations/line/webhook-gateway", () => ({
  ingestWebhookEvents: mocks.ingestWebhookEvents,
}));

import { POST } from "./route";

const CHANNEL = "a1c00000-0000-4000-8000-000000000001";
const ORG = "20000000-0000-4000-8000-000000000001";
const SECRET = "test-channel-secret";

function signedRequest(body: string, signature: string): Request {
  return new Request(`http://localhost/api/v2/webhooks/line/${CHANNEL}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-line-signature": signature },
    body,
  });
}

function validSignature(body: string): string {
  return createHmac("sha256", SECRET).update(Buffer.from(body, "utf8")).digest("base64");
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createAdminSupabaseClient.mockReturnValue({ rpc: mocks.rpc });
  // The secret-material RPC returns hex ciphertext; decrypt is stubbed to the plaintext.
  mocks.rpc.mockResolvedValue({
    data: {
      organizationId: ORG,
      credentialConfigured: true,
      keyVersion: 1,
      secretCiphertext: "00",
      secretNonce: "00",
    },
    error: null,
  });
  mocks.decryptCredential.mockReturnValue(SECRET);
  mocks.ingestWebhookEvents.mockResolvedValue({ ingested: 1, duplicate: 0 });
});

describe("POST /api/v2/webhooks/line/[channelId]", () => {
  const body = JSON.stringify({ destination: "d", events: [{ type: "follow", timestamp: 1 }] });

  it("驗章: returns 200 and ingests when the signature is valid", async () => {
    const response = await POST(signedRequest(body, validSignature(body)), {
      params: Promise.resolve({ channelId: CHANNEL }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(mocks.ingestWebhookEvents).toHaveBeenCalledTimes(1);
  });

  it("驗章: returns 401 and never ingests when the signature is wrong", async () => {
    const response = await POST(signedRequest(body, "aGVsbG8="), {
      params: Promise.resolve({ channelId: CHANNEL }),
    });
    expect(response.status).toBe(401);
    expect(mocks.ingestWebhookEvents).not.toHaveBeenCalled();
  });

  it("returns 401 when the signature header is missing", async () => {
    const request = new Request(`http://localhost/api/v2/webhooks/line/${CHANNEL}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    const response = await POST(request, { params: Promise.resolve({ channelId: CHANNEL }) });
    expect(response.status).toBe(401);
    expect(mocks.ingestWebhookEvents).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown channel without leaking state", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "LINE_CHANNEL_NOT_FOUND" } });
    const response = await POST(signedRequest(body, validSignature(body)), {
      params: Promise.resolve({ channelId: CHANNEL }),
    });
    expect(response.status).toBe(404);
    expect(mocks.ingestWebhookEvents).not.toHaveBeenCalled();
  });

  it("returns 401 when the channel has no stored credential", async () => {
    mocks.rpc.mockResolvedValue({
      data: { organizationId: ORG, credentialConfigured: false },
      error: null,
    });
    const response = await POST(signedRequest(body, validSignature(body)), {
      params: Promise.resolve({ channelId: CHANNEL }),
    });
    expect(response.status).toBe(401);
  });

  it("returns 404 for a malformed channel id", async () => {
    const response = await POST(signedRequest(body, validSignature(body)), {
      params: Promise.resolve({ channelId: "not-a-uuid" }),
    });
    expect(response.status).toBe(404);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
