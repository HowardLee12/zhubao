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
vi.mock("@/server/supabase/admin", () => ({ createAdminSupabaseClient: () => ({ rpc }) }));
vi.mock("@/server/api/csrf", async (orig) => {
  const actual = await orig<typeof import("@/server/api/csrf")>();
  return { ...actual, verifyCsrf: vi.fn(), configuredAppOrigin: vi.fn(() => "https://renoly.test") };
});

import { POST } from "./route";

const orgId = "20000000-0000-4000-8000-000000000001";
const milestoneId = "70000000-0000-4000-8000-000000000001";
const params = { params: Promise.resolve({ orgId, id: milestoneId }) };

function request(body: unknown): Request {
  return new Request("https://renoly.test/x", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "if-match": '"3"',
      "idempotency-key": "idem-abc12345",
    },
    body: JSON.stringify(body),
  });
}

describe("payment mark-paid action route", () => {
  afterEach(() => vi.clearAllMocks());

  it("marks a milestone paid and returns the new ETag", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
    rpc.mockImplementation((name: string) => {
      if (name === "consume_pilot_authenticated_rate_limit") {
        return Promise.resolve({ data: "ok", error: null });
      }
      return Promise.resolve({ data: { id: "m1", status: "paid", lockVersion: 4 }, error: null });
    });

    const response = await POST(request({ paymentMethod: "cash" }), params);
    expect(response.status).toBe(200);
    expect(response.headers.get("etag")).toBe('"4"');
  });

  it("maps a sensitive-field rejection to 422 without leaking the value", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
    rpc.mockImplementation((name: string) => {
      if (name === "consume_pilot_authenticated_rate_limit") {
        return Promise.resolve({ data: "ok", error: null });
      }
      return Promise.resolve({
        data: null,
        error: { code: "RENSF", message: "PAYMENT_SENSITIVE_FIELD_REJECTED" },
      });
    });

    const response = await POST(request({ metadata: { cardNumber: "4111111111111111" } }), params);
    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.code).toBe("SENSITIVE_FIELD_REJECTED");
    expect(JSON.stringify(body)).not.toContain("4111111111111111");
  });

  it("rejects a missing If-Match with 428", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
    const response = await POST(
      new Request("https://renoly.test/x", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ paymentMethod: "cash" }),
      }),
      params,
    );
    expect(response.status).toBe(428);
  });
});
