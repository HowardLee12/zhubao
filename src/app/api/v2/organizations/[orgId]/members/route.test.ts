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
const params = { params: Promise.resolve({ orgId }) };

describe("GET .../members", () => {
  afterEach(() => {
    vi.clearAllMocks();
    authorize.mockResolvedValue({ userId: "u1" });
  });

  it("returns active operational members from the authenticated RPC", async () => {
    rpc.mockResolvedValueOnce({
      data: [
        {
          id: "30000000-0000-4000-8000-000000000003",
          display_name: "Alpha 技師 A",
          role: "technician",
          status: "active",
        },
      ],
      error: null,
    });

    const response = await GET(new Request("https://renoly.test/x"), params);
    expect(response.status).toBe(200);
    expect((await response.json()).data[0]).toEqual({
      id: "30000000-0000-4000-8000-000000000003",
      displayName: "Alpha 技師 A",
      role: "technician",
      status: "active",
    });
    expect(rpc).toHaveBeenCalledWith("list_pilot_assignable_members", {
      p_organization_id: orgId,
    });
  });

  it("does not call the projection when the manager gate rejects the caller", async () => {
    const { ApiProblem } = await import("@/server/api/problem");
    authorize.mockRejectedValueOnce(
      new ApiProblem({ status: 403, code: "FORBIDDEN", title: "x", detail: "y" }),
    );

    const response = await GET(new Request("https://renoly.test/x"), params);
    expect(response.status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });
});
