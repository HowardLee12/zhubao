import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  getUser: vi.fn(),
  createSupabaseServerClient: vi.fn(),
}));

vi.mock("@/server/supabase/server", () => ({
  createSupabaseServerClient: mocks.createSupabaseServerClient,
}));

import { POST } from "./route";

const ORG = "20000000-0000-4000-8000-000000000001";
const NOTIF = "88100000-0000-4000-8000-000000000001";
const csrf = "csrf-token-value-0123456789-abcdefghij";

function request(headers: Record<string, string> = {}): Request {
  return new Request(
    `http://localhost/api/v2/organizations/${ORG}/notifications/${NOTIF}/actions/retry`,
    {
      method: "POST",
      headers: {
        origin: "http://localhost",
        cookie: `renoly-csrf=${csrf}`,
        "x-csrf-token": csrf,
        ...headers,
      },
    },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
  mocks.createSupabaseServerClient.mockResolvedValue({
    auth: { getUser: mocks.getUser },
    rpc: mocks.rpc,
  });
  mocks.rpc.mockResolvedValue({ data: { id: NOTIF, status: "pending" }, error: null });
});

describe("POST .../notifications/[id]/actions/retry", () => {
  it("re-queues a failed notification and returns pending", async () => {
    const response = await POST(request(), {
      params: Promise.resolve({ orgId: ORG, id: NOTIF }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.status).toBe("pending");
    expect(mocks.rpc).toHaveBeenCalledWith("retry_notification", {
      target_org: ORG,
      p_notification_id: NOTIF,
    });
  });

  it("rejects CSRF failures (403) before the RPC", async () => {
    const response = await POST(request({ "x-csrf-token": "" }), {
      params: Promise.resolve({ orgId: ORG, id: NOTIF }),
    });
    expect(response.status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("maps NOTIFICATION_NOT_RETRYABLE to 409", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "NOTIFICATION_NOT_RETRYABLE" } });
    const response = await POST(request(), {
      params: Promise.resolve({ orgId: ORG, id: NOTIF }),
    });
    expect(response.status).toBe(409);
  });

  it("maps a cross-tenant NOTIFICATION_NOT_FOUND to a non-leaky 404", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "NOTIFICATION_NOT_FOUND" } });
    const response = await POST(request(), {
      params: Promise.resolve({ orgId: ORG, id: NOTIF }),
    });
    expect(response.status).toBe(404);
  });
});
