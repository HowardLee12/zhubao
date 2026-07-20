import { randomBytes } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  getUser: vi.fn(),
  createSupabaseServerClient: vi.fn(),
}));

vi.mock("@/server/supabase/server", () => ({
  createSupabaseServerClient: mocks.createSupabaseServerClient,
}));

import { GET, POST } from "./route";

const ORG = "20000000-0000-4000-8000-000000000001";
const csrf = "csrf-token-value-0123456789-abcdefghij";

process.env.LINE_CREDENTIAL_MASTER_KEY_V1 = randomBytes(32).toString("base64");

const validBody = {
  name: "Alpha 官方帳號",
  channelId: "alpha-oa-channel-id",
  channelSecret: "super-secret-value",
  accessToken: "long-lived-access-token",
};

function request(body: unknown = validBody, headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost/api/v2/organizations/${ORG}/line-channels`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost",
      cookie: `renoly-csrf=${csrf}`,
      "x-csrf-token": csrf,
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
  mocks.createSupabaseServerClient.mockResolvedValue({
    auth: { getUser: mocks.getUser },
    rpc: mocks.rpc,
  });
  // list (existing lookup) -> empty; connect -> success DTO.
  mocks.rpc.mockImplementation((fn: string) => {
    if (fn === "list_line_channels") {
      return Promise.resolve({ data: { organizationId: ORG, items: [] }, error: null });
    }
    if (fn === "connect_line_channel") {
      return Promise.resolve({
        data: { id: "a1c00000-0000-4000-8000-000000000001", status: "active", credentialConfigured: true },
        error: null,
      });
    }
    return Promise.resolve({ data: null, error: null });
  });
});

describe("POST /api/v2/organizations/[orgId]/line-channels", () => {
  it("encrypts credentials server-side and returns credentialConfigured, never the plaintext", async () => {
    const response = await POST(request(), { params: Promise.resolve({ orgId: ORG }) });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.credentialConfigured).toBe(true);

    // The response body must NEVER contain the secret or token plaintext/ciphertext.
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("super-secret-value");
    expect(serialized).not.toContain("long-lived-access-token");

    // The connect RPC received bytea hex literals, not plaintext.
    const connectCall = mocks.rpc.mock.calls.find((c) => c[0] === "connect_line_channel");
    expect(connectCall).toBeDefined();
    const args = connectCall![1] as Record<string, string>;
    expect(args.p_secret_ciphertext).toMatch(/^\\x[0-9a-f]+$/);
    expect(args.p_secret_ciphertext).not.toContain("super-secret-value");
    expect(args.p_access_token_ciphertext).not.toContain("long-lived-access-token");
  });

  it("rejects a request that fails CSRF (403) before touching the RPC", async () => {
    const response = await POST(request(validBody, { "x-csrf-token": "" }), {
      params: Promise.resolve({ orgId: ORG }),
    });
    expect(response.status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("returns 401 when unauthenticated", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    const response = await POST(request(), { params: Promise.resolve({ orgId: ORG }) });
    expect(response.status).toBe(401);
  });

  it("maps a FORBIDDEN connect error to 403", async () => {
    mocks.rpc.mockImplementation((fn: string) => {
      if (fn === "list_line_channels") {
        return Promise.resolve({ data: { organizationId: ORG, items: [] }, error: null });
      }
      return Promise.resolve({ data: null, error: { message: "FORBIDDEN" } });
    });
    const response = await POST(request(), { params: Promise.resolve({ orgId: ORG }) });
    expect(response.status).toBe(403);
  });

  it("reuses the org's existing channel id for the AAD when one already exists", async () => {
    const existingId = "a1c00000-0000-4000-8000-000000000001";
    mocks.rpc.mockImplementation((fn: string) => {
      if (fn === "list_line_channels") {
        return Promise.resolve({
          data: {
            organizationId: ORG,
            items: [
              {
                id: existingId,
                name: "OA",
                channelId: "cid",
                basicId: null,
                liffId: null,
                status: "active",
                credentialConfigured: true,
                webhookVerifiedAt: null,
                lastWebhookAt: null,
                lastErrorCode: null,
                lockVersion: 1,
              },
            ],
          },
          error: null,
        });
      }
      return Promise.resolve({
        data: { id: existingId, status: "active", credentialConfigured: true },
        error: null,
      });
    });
    const response = await POST(request(), { params: Promise.resolve({ orgId: ORG }) });
    expect(response.status).toBe(200);
    const connectCall = mocks.rpc.mock.calls.find((c) => c[0] === "connect_line_channel");
    expect(connectCall![1].p_channel_row_id).toBe(existingId);
  });
});

describe("GET /api/v2/organizations/[orgId]/line-channels", () => {
  function getRequest(): Request {
    return new Request(`http://localhost/api/v2/organizations/${ORG}/line-channels`, {
      method: "GET",
      headers: { accept: "application/json" },
    });
  }

  it("lists the redacted channels", async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        organizationId: ORG,
        items: [
          {
            id: "a1c00000-0000-4000-8000-000000000001",
            name: "OA",
            channelId: "cid",
            basicId: null,
            liffId: null,
            status: "active",
            credentialConfigured: true,
            webhookVerifiedAt: null,
            lastWebhookAt: null,
            lastErrorCode: null,
            lockVersion: 1,
          },
        ],
      },
      error: null,
    });
    const response = await GET(getRequest(), { params: Promise.resolve({ orgId: ORG }) });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toHaveLength(1);
    // The redacted DTO exposes credentialConfigured, never ciphertext.
    expect(body.data[0]).not.toHaveProperty("secretCiphertext");
    expect(body.data[0].credentialConfigured).toBe(true);
  });

  it("returns 401 when unauthenticated", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    const response = await GET(getRequest(), { params: Promise.resolve({ orgId: ORG }) });
    expect(response.status).toBe(401);
  });
});
