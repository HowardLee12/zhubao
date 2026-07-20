import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAdminSupabaseClient: vi.fn(),
  dispatchClaimedNotifications: vi.fn(),
  createLineMessenger: vi.fn(),
}));

vi.mock("@/server/supabase/admin", () => ({
  createAdminSupabaseClient: mocks.createAdminSupabaseClient,
}));
vi.mock("@/server/notifications/gateway", () => ({
  dispatchClaimedNotifications: mocks.dispatchClaimedNotifications,
}));
vi.mock("@/server/integrations/line/client", () => ({
  createLineMessenger: mocks.createLineMessenger,
}));

import { POST } from "./route";

const WORKER_SECRET = "worker-secret-value-abcdefghijklmnop";

function request(headers: Record<string, string> = {}, body?: unknown): Request {
  return new Request("http://localhost/api/v2/internal/workers/notification-dispatch", {
    method: "POST",
    headers: {
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.WORKER_SECRET = WORKER_SECRET;
  mocks.createAdminSupabaseClient.mockReturnValue({ rpc: vi.fn() });
  mocks.createLineMessenger.mockReturnValue({ pushMessage: vi.fn() });
  mocks.dispatchClaimedNotifications.mockResolvedValue({
    claimed: 2,
    sent: 2,
    retried: 0,
    failed: 0,
    skipped: 0,
  });
});

describe("POST /api/v2/internal/workers/notification-dispatch", () => {
  it("rejects a request without the worker bearer secret (401) and never dispatches", async () => {
    const response = await POST(request());
    expect(response.status).toBe(401);
    expect(mocks.dispatchClaimedNotifications).not.toHaveBeenCalled();
  });

  it("rejects a wrong secret (401)", async () => {
    const response = await POST(request({ authorization: "Bearer nope-not-the-secret-value-xxxx" }));
    expect(response.status).toBe(401);
    expect(mocks.dispatchClaimedNotifications).not.toHaveBeenCalled();
  });

  it("dispatches with the fake/real messenger and returns the summary", async () => {
    const response = await POST(
      request({ authorization: `Bearer ${WORKER_SECRET}` }, { limit: 5 }),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.sent).toBe(2);
    expect(mocks.dispatchClaimedNotifications).toHaveBeenCalledTimes(1);
    expect(mocks.dispatchClaimedNotifications.mock.calls[0][0].limit).toBe(5);
  });

  it("accepts an empty body (no limit)", async () => {
    const response = await POST(request({ authorization: `Bearer ${WORKER_SECRET}` }));
    expect(response.status).toBe(200);
    expect(mocks.dispatchClaimedNotifications.mock.calls[0][0].limit).toBeUndefined();
  });

  it("wires a resolveTarget that decrypts the access token + looks up the LINE user id", async () => {
    process.env.LINE_CREDENTIAL_MASTER_KEY_V1 = Buffer.alloc(32, 7).toString("base64");
    const { encryptCredential } = await import("@/server/integrations/line/credentials");
    const enc = encryptCredential(
      "a-real-token",
      { organizationId: "o", lineChannelId: "c", credentialType: "access_token" },
      1,
    );

    // Admin client that answers the identity lookup + the secret-material RPC.
    const identityBuilder = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { line_user_id: "Uxyz" }, error: null }),
    };
    const admin = {
      schema: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue(identityBuilder) }),
      rpc: vi.fn().mockResolvedValue({
        data: {
          credentialConfigured: true,
          keyVersion: 1,
          accessTokenCiphertext: enc.ciphertext.toString("hex"),
          accessTokenNonce: enc.nonce.toString("hex"),
        },
        error: null,
      }),
    };
    mocks.createAdminSupabaseClient.mockReturnValue(admin);

    await POST(request({ authorization: `Bearer ${WORKER_SECRET}` }));
    const resolveTarget = mocks.dispatchClaimedNotifications.mock.calls[0][0].resolveTarget;

    const target = await resolveTarget({
      organizationId: "o",
      lineChannelId: "c",
      customerLineIdentityId: "id",
    });
    expect(target).toEqual({ to: "Uxyz", accessToken: "a-real-token" });

    // A row with no channel/identity resolves to null (permanent fail, not retried).
    expect(await resolveTarget({ organizationId: "o", lineChannelId: null, customerLineIdentityId: null })).toBeNull();
  });

  it("rejects an invalid limit (422)", async () => {
    const response = await POST(
      request({ authorization: `Bearer ${WORKER_SECRET}` }, { limit: 999 }),
    );
    expect(response.status).toBe(422);
    expect(mocks.dispatchClaimedNotifications).not.toHaveBeenCalled();
  });
});
