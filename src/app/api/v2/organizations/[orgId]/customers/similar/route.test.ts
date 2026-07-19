import { afterEach, describe, expect, it, vi } from "vitest";

const { getUser, rpc, createSupabaseServerClient } = vi.hoisted(() => {
  const getUser = vi.fn();
  const rpc = vi.fn();
  return {
    getUser,
    rpc,
    createSupabaseServerClient: vi.fn(async () => ({ auth: { getUser }, rpc })),
  };
});

vi.mock("@/server/supabase/server", () => ({ createSupabaseServerClient }));

import { GET } from "./route";

const orgId = "20000000-0000-4000-8000-000000000001";
const params = { params: Promise.resolve({ orgId }) };

describe("GET .../customers/similar", () => {
  afterEach(() => vi.clearAllMocks());

  it("returns hint DTOs for a phone lookup", async () => {
    getUser.mockResolvedValue({ data: { user: { id: crypto.randomUUID() } }, error: null });
    rpc.mockResolvedValue({
      data: [
        {
          customer_id: "40000000-0000-4000-8000-000000000001",
          customer_no: "C-2026-0001",
          name: "示範客戶甲",
          phone: "+886912345678",
          match_reason: "phone",
        },
      ],
      error: null,
    });

    const response = await GET(
      new Request(`https://renoly.test/x?phone=%2B886912345678`),
      params,
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data[0].matchReason).toBe("phone");
    expect(rpc).toHaveBeenCalledWith("find_similar_customers", {
      target_org: orgId,
      p_phone: "+886912345678",
      p_name: null,
      p_limit: 5,
    });
  });

  it("rejects a request with neither phone nor name", async () => {
    getUser.mockResolvedValue({ data: { user: { id: crypto.randomUUID() } }, error: null });

    const response = await GET(new Request(`https://renoly.test/x`), params);
    expect(response.status).toBe(422);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("maps a FORBIDDEN RPC error to 403", async () => {
    getUser.mockResolvedValue({ data: { user: { id: crypto.randomUUID() } }, error: null });
    rpc.mockResolvedValue({ data: null, error: { message: "FORBIDDEN" } });

    const response = await GET(new Request(`https://renoly.test/x?name=王`), params);
    expect(response.status).toBe(403);
  });

  it("requires a session", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: { message: "no" } });

    const response = await GET(new Request(`https://renoly.test/x?name=王`), params);
    expect(response.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });
});
