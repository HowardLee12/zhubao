import { afterEach, describe, expect, it, vi } from "vitest";

const { rpc, getUser, createSupabaseServerClient } = vi.hoisted(() => {
  const rpc = vi.fn();
  const getUser = vi.fn();
  return {
    rpc,
    getUser,
    createSupabaseServerClient: vi.fn(async () => ({ rpc, auth: { getUser } })),
  };
});

vi.mock("@/server/supabase/server", () => ({ createSupabaseServerClient }));
// The authenticated rate limiter runs on a service-role admin client; share the
// same rpc mock so consume_pilot_authenticated_rate_limit is handled identically.
vi.mock("@/server/supabase/admin", () => ({ createAdminSupabaseClient: () => ({ rpc }) }));
vi.mock("@/server/api/csrf", async (orig) => {
  const actual = await orig<typeof import("@/server/api/csrf")>();
  return { ...actual, verifyCsrf: vi.fn(), configuredAppOrigin: vi.fn(() => "https://renoly.test") };
});

import { GET, POST } from "./route";

const orgId = "20000000-0000-4000-8000-000000000001";
const projectId = "30000000-0000-4000-8000-000000000001";
const params = { params: Promise.resolve({ orgId }) };

function okRateLimit() {
  rpc.mockImplementation((name: string) => {
    if (name === "consume_pilot_authenticated_rate_limit") {
      return Promise.resolve({ data: "ok", error: null });
    }
    return Promise.resolve({ data: {}, error: null });
  });
}

describe("payment-milestones collection route", () => {
  afterEach(() => vi.clearAllMocks());

  it("lists milestones with an includeAmounts envelope", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
    rpc.mockImplementation((name: string) => {
      if (name === "consume_pilot_authenticated_rate_limit") {
        return Promise.resolve({ data: "ok", error: null });
      }
      return Promise.resolve({ data: { milestones: [], includeAmounts: true }, error: null });
    });

    const response = await GET(new Request("https://renoly.test/x?status=overdue"), params);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.includeAmounts).toBe(true);
    expect(rpc).toHaveBeenCalledWith(
      "consume_pilot_authenticated_rate_limit",
      expect.objectContaining({ p_action: "read" }),
    );
  });

  it("creates a milestone and returns 201 with an ETag", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
    rpc.mockImplementation((name: string) => {
      if (name === "consume_pilot_authenticated_rate_limit") {
        return Promise.resolve({ data: "ok", error: null });
      }
      return Promise.resolve({ data: { id: "m1", lockVersion: 1 }, error: null });
    });

    const response = await POST(
      new Request("https://renoly.test/x", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId, name: "訂金", amountMinor: 5000 }),
      }),
      params,
    );
    expect(response.status).toBe(201);
    expect(response.headers.get("etag")).toBe('"1"');
    expect(rpc).toHaveBeenCalledWith(
      "consume_pilot_authenticated_rate_limit",
      expect.objectContaining({ p_action: "mutation" }),
    );
  });

  it("returns 429 when the mutation rate limit is exceeded (count not rolled back)", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
    rpc.mockImplementation((name: string) => {
      if (name === "consume_pilot_authenticated_rate_limit") {
        return Promise.resolve({ data: "limited", error: null });
      }
      return Promise.resolve({ data: { id: "m1" }, error: null });
    });

    const response = await POST(
      new Request("https://renoly.test/x", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId, name: "訂金", amountMinor: 5000 }),
      }),
      params,
    );
    expect(response.status).toBe(429);
    // create_payment_milestone must NOT have run once the limiter tripped.
    expect(rpc).not.toHaveBeenCalledWith("create_payment_milestone", expect.anything());
  });

  it("rejects a missing auth session with 401", async () => {
    okRateLimit();
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    const response = await GET(new Request("https://renoly.test/x"), params);
    expect(response.status).toBe(401);
  });
});
