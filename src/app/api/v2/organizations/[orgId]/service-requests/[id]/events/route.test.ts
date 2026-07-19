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
const id = "80000000-0000-4000-8000-000000000001";
const params = { params: Promise.resolve({ orgId, id }) };

describe("GET .../service-requests/:id/events", () => {
  afterEach(() => {
    vi.clearAllMocks();
    authorize.mockResolvedValue({ userId: "u1" });
  });

  it("returns the scoped RPC timeline and keeps a second redaction guard", async () => {
    rpc.mockResolvedValueOnce({
      data: [
        {
          id: "e0000000-0000-4000-8000-000000000001",
          event_type: "service_request.public_submitted",
          actor_type: "system",
          actor_user_id: null,
          occurred_at: "2026-07-16T10:00:00.000Z",
          chain_sequence: 1,
          payload: { requestNo: "SR-1", submission: { contactPhone: "+886912345678" } },
        },
      ],
      error: null,
    });

    const response = await GET(new Request("https://renoly.test/x"), params);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data[0].eventType).toBe("service_request.public_submitted");
    expect(JSON.stringify(body)).not.toContain("+886912345678");
    expect(body.meta).toEqual({ hasMore: false, nextCursor: null });
    expect(rpc).toHaveBeenCalledWith("list_pilot_service_request_events", {
      p_organization_id: orgId,
      p_service_request_id: id,
      p_after_sequence: null,
      p_limit: 50,
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
