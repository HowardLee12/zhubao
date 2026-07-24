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

describe("GET .../customers/:customerId/locations", () => {
  afterEach(() => {
    vi.clearAllMocks();
    authorize.mockResolvedValue({ userId: "u1" });
  });

  it("returns locations projected by the authenticated RPC", async () => {
    rpc.mockResolvedValueOnce({
      data: [
        {
          id: "50000000-0000-4000-8000-000000000001",
          customer_id: customerId,
          label: "住家",
          contact_name: null,
          contact_phone: null,
          postal_code: null,
          county: "台北市",
          district: "松山區",
          address_line: "民生東路四段 88 號",
          access_notes: "",
          is_default: true,
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
    expect(body.data[0].addressLine).toBe("民生東路四段 88 號");
    expect(body.data[0].isDefault).toBe(true);
    expect(rpc).toHaveBeenCalledWith("list_pilot_customer_locations", {
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
