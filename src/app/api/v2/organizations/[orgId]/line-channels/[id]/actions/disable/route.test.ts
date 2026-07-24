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
const CHANNEL = "a1c00000-0000-4000-8000-000000000001";
const csrf = "csrf-token-value-0123456789-abcdefghij";

function request(body: unknown = { reason: "手動停用" }, headers: Record<string, string> = {}): Request {
  return new Request(
    `http://localhost/api/v2/organizations/${ORG}/line-channels/${CHANNEL}/actions/disable`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost",
        cookie: `renoly-csrf=${csrf}`,
        "x-csrf-token": csrf,
        ...headers,
      },
      body: JSON.stringify(body),
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
  mocks.rpc.mockResolvedValue({ data: { id: CHANNEL, status: "disabled" }, error: null });
});

describe("POST .../line-channels/[id]/actions/disable (kill switch)", () => {
  it("disables the channel and passes the reason to the RPC", async () => {
    const response = await POST(request(), {
      params: Promise.resolve({ orgId: ORG, id: CHANNEL }),
    });
    expect(response.status).toBe(200);
    expect((await response.json()).data.status).toBe("disabled");
    expect(mocks.rpc).toHaveBeenCalledWith("disable_line_channel", {
      target_org: ORG,
      p_channel_id: CHANNEL,
      p_reason: "手動停用",
    });
  });

  it("accepts an empty body (reason null)", async () => {
    const response = await POST(request(undefined, { "content-type": "text/plain" }), {
      params: Promise.resolve({ orgId: ORG, id: CHANNEL }),
    });
    expect(response.status).toBe(200);
    expect(mocks.rpc.mock.calls[0][1].p_reason).toBeNull();
  });

  it("rejects CSRF failures (403) before the RPC", async () => {
    const response = await POST(request({ reason: "x" }, { "x-csrf-token": "" }), {
      params: Promise.resolve({ orgId: ORG, id: CHANNEL }),
    });
    expect(response.status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("maps FORBIDDEN to 403", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "FORBIDDEN" } });
    const response = await POST(request(), {
      params: Promise.resolve({ orgId: ORG, id: CHANNEL }),
    });
    expect(response.status).toBe(403);
  });

  it("maps LINE_CHANNEL_NOT_FOUND to 404", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "LINE_CHANNEL_NOT_FOUND" } });
    const response = await POST(request(), {
      params: Promise.resolve({ orgId: ORG, id: CHANNEL }),
    });
    expect(response.status).toBe(404);
  });
});
