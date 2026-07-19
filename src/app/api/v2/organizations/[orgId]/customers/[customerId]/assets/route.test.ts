import { afterEach, describe, expect, it, vi } from "vitest";

const { rpc, createSupabaseServerClient, authorize } = vi.hoisted(() => {
  const rpc = vi.fn();
  return {
    rpc,
    createSupabaseServerClient: vi.fn(async () => ({ rpc })),
    authorize: vi.fn(async () => ({ userId: "u1" })),
  };
});

vi.mock("@/server/supabase/server", () => ({ createSupabaseServerClient }));
vi.mock("@/server/api/org-authorization", () => ({ authorizeOrgManager: authorize }));

import { GET } from "./route";

const orgId = "20000000-0000-4000-8000-000000000001";
const customerId = "40000000-0000-4000-8000-000000000001";
const params = { params: Promise.resolve({ orgId, customerId }) };

describe("GET .../customers/:customerId/assets", () => {
  afterEach(() => {
    vi.clearAllMocks();
    authorize.mockResolvedValue({ userId: "u1" });
  });

  it("returns assets projected by the authenticated RPC", async () => {
    rpc.mockResolvedValueOnce({
      data: [
        {
          id: "60000000-0000-4000-8000-000000000001",
          customer_id: customerId,
          location_id: "50000000-0000-4000-8000-000000000001",
          asset_no: "A-2026-0001",
          asset_type: "air_conditioner",
          name: "主臥冷氣",
          brand: "示範品牌",
          model: "DEMO-01",
          serial_number: null,
          installed_on: null,
          status: "active",
          lock_version: 1,
          created_at: "2026-01-02T00:00:00.000Z",
          updated_at: "2026-01-02T00:00:00.000Z",
        },
      ],
      error: null,
    });

    const response = await GET(new Request("https://renoly.test/x"), params);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data[0].assetNo).toBe("A-2026-0001");
    expect(body.data[0].assetType).toBe("air_conditioner");
    expect(rpc).toHaveBeenCalledWith("list_pilot_customer_assets", {
      p_organization_id: orgId,
      p_customer_id: customerId,
    });
  });

  it("propagates a 403 from the authorization gate", async () => {
    const { ApiProblem } = await import("@/server/api/problem");
    authorize.mockRejectedValueOnce(
      new ApiProblem({ status: 403, code: "FORBIDDEN", title: "x", detail: "y" }),
    );

    const response = await GET(new Request("https://renoly.test/x"), params);
    expect(response.status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });
});
