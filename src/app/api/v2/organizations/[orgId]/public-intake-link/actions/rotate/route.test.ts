import { afterEach, describe, expect, it, vi } from "vitest";

const { getUser, rpc, createSupabaseServerClient, createPublicIntakeToken } = vi.hoisted(() => {
  const getUser = vi.fn();
  const rpc = vi.fn();
  return {
    getUser,
    rpc,
    createSupabaseServerClient: vi.fn(async () => ({ auth: { getUser }, rpc })),
    createPublicIntakeToken: vi.fn(() => ({ rawToken: "x".repeat(43), hashHex: "a".repeat(64) })),
  };
});

vi.mock("@/server/supabase/server", () => ({ createSupabaseServerClient }));
vi.mock("@/server/supabase/public-token", () => ({ createPublicIntakeToken }));

import { POST } from "./route";

const orgId = "2f66bf0a-b8d9-4722-9e2a-23f218f25d86";
const ROUTE = `https://renoly.test/api/v2/organizations/${orgId}/public-intake-link/actions/rotate`;
const CSRF_TOKEN = "rotate-csrf-token-0123456789-abcdefghij";

function rotateRequest(extraHeaders: Record<string, string> = {}): Request {
  return new Request(ROUTE, {
    method: "POST",
    headers: {
      origin: "https://renoly.test",
      "x-csrf-token": CSRF_TOKEN,
      cookie: `renoly-csrf=${CSRF_TOKEN}`,
      "idempotency-key": "rotate-idempotency-key",
      ...extraHeaders,
    },
  });
}

describe("POST pilot public intake link rotation", () => {
  afterEach(() => vi.clearAllMocks());

  it("rotates only the stored hash and returns the raw URL once", async () => {
    getUser.mockResolvedValue({ data: { user: { id: crypto.randomUUID() } }, error: null });
    rpc.mockResolvedValue({
      data: {
        organizationId: orgId,
        rotatedAt: "2026-07-16T10:00:00.000Z",
        expiresAt: "2027-07-16T10:00:00.000Z",
      },
      error: null,
    });

    const response = await POST(rotateRequest(), { params: Promise.resolve({ orgId }) });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: { publicIntakeUrl: `https://renoly.test/request/${"x".repeat(43)}` },
    });
    expect(rpc).toHaveBeenCalledWith("rotate_pilot_intake_token", {
      p_organization_id: orgId,
      p_new_token_hash_hex: "a".repeat(64),
      p_idempotency_key: "rotate-idempotency-key",
    });
    expect(JSON.stringify(rpc.mock.calls)).not.toContain("x".repeat(43));
  });

  it("rejects a cross-origin rotation before generating a token or calling the RPC", async () => {
    getUser.mockResolvedValue({ data: { user: { id: crypto.randomUUID() } }, error: null });

    const response = await POST(
      rotateRequest({ origin: "https://evil.example" }),
      { params: Promise.resolve({ orgId }) },
    );

    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe("CSRF_INVALID");
    expect(createPublicIntakeToken).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("requires an Idempotency-Key so a retry cannot silently re-rotate", async () => {
    getUser.mockResolvedValue({ data: { user: { id: crypto.randomUUID() } }, error: null });

    const request = new Request(ROUTE, {
      method: "POST",
      headers: {
        origin: "https://renoly.test",
        "x-csrf-token": CSRF_TOKEN,
        cookie: `renoly-csrf=${CSRF_TOKEN}`,
      },
    });
    const response = await POST(request, { params: Promise.resolve({ orgId }) });

    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("IDEMPOTENCY_KEY_REQUIRED");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("maps an idempotency conflict from the RPC to a 409", async () => {
    getUser.mockResolvedValue({ data: { user: { id: crypto.randomUUID() } }, error: null });
    rpc.mockResolvedValue({
      data: null,
      error: { code: "22023", message: "PILOT_IDEMPOTENCY_CONFLICT" },
    });

    const response = await POST(rotateRequest(), { params: Promise.resolve({ orgId }) });

    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("IDEMPOTENCY_CONFLICT");
  });

  it("does not generate or rotate a token without an authenticated user", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: { message: "invalid" } });

    const response = await POST(rotateRequest(), { params: Promise.resolve({ orgId }) });

    expect(response.status).toBe(401);
    expect(createPublicIntakeToken).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
});
