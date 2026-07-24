import { beforeEach, describe, expect, it, vi } from "vitest";

const supabaseMocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  rpc: vi.fn(),
  createSupabaseServerClient: vi.fn(),
}));

vi.mock("@/server/supabase/server", () => ({
  createSupabaseServerClient: supabaseMocks.createSupabaseServerClient,
}));

import { GET } from "./route";

describe("GET /api/v2/session", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    supabaseMocks.createSupabaseServerClient.mockResolvedValue({
      auth: { getUser: supabaseMocks.getUser },
      rpc: supabaseMocks.rpc,
    });
    supabaseMocks.getUser.mockResolvedValue({
      data: {
        user: {
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          email: "owner@example.com",
          identities: [{ identity_data: { access_token: "never-return-me" } }],
        },
      },
      error: null,
    });
    supabaseMocks.rpc.mockResolvedValue({
      data: {
        memberships: [
          {
            id: "22222222-2222-4222-8222-222222222222",
            organizationId: "11111111-1111-4111-8111-111111111111",
            organizationName: "北城工程",
            organizationSlug: "north-city-service",
            role: "owner",
            status: "active",
          },
        ],
        activeOrganizationId: "11111111-1111-4111-8111-111111111111",
      },
      error: null,
    });
  });

  it("returns a minimal verified user and active memberships without provider data", async () => {
    const response = await GET(
      new Request("https://app.renoly.test/api/v2/session", {
        headers: {
          "x-request-id": "67427c45-e326-4a0a-b7b7-82cf53999df7",
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-request-id")).toBe(
      "67427c45-e326-4a0a-b7b7-82cf53999df7",
    );
    expect(await response.json()).toEqual({
      data: {
        user: {
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          email: "owner@example.com",
        },
        memberships: [
          {
            id: "22222222-2222-4222-8222-222222222222",
            organizationId: "11111111-1111-4111-8111-111111111111",
            organizationName: "北城工程",
            organizationSlug: "north-city-service",
            role: "owner",
            status: "active",
          },
        ],
        activeOrganizationId: "11111111-1111-4111-8111-111111111111",
      },
    });
    expect(supabaseMocks.rpc).toHaveBeenCalledWith("get_pilot_session");
  });

  it("returns 401 and never queries memberships without a verified user", async () => {
    supabaseMocks.getUser.mockResolvedValue({
      data: { user: null },
      error: { message: "invalid JWT" },
    });

    const response = await GET(
      new Request("https://app.renoly.test/api/v2/session"),
    );

    expect(response.status).toBe(401);
    expect((await response.json()).code).toBe("AUTHENTICATION_REQUIRED");
    expect(supabaseMocks.rpc).not.toHaveBeenCalled();
  });

  it("supports a signed-in user who has not created a workspace", async () => {
    supabaseMocks.rpc.mockResolvedValue({
      data: { memberships: [], activeOrganizationId: null },
      error: null,
    });

    const response = await GET(
      new Request("https://app.renoly.test/api/v2/session"),
    );

    expect(response.status).toBe(200);
    expect((await response.json()).data).toMatchObject({
      memberships: [],
      activeOrganizationId: null,
    });
  });

  it("sanitizes RPC failures", async () => {
    supabaseMocks.rpc.mockResolvedValue({
      data: null,
      error: { message: "private membership SQL detail" },
    });

    const response = await GET(
      new Request("https://app.renoly.test/api/v2/session"),
    );

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.code).toBe("INTERNAL_ERROR");
    expect(JSON.stringify(body)).not.toContain("private membership SQL detail");
  });
});
