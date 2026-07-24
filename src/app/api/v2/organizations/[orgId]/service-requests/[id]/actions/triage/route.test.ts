import { afterEach, describe, expect, it, vi } from "vitest";

const { getUser, rpc, createSupabaseServerClient, verifyCsrf } = vi.hoisted(() => {
  const getUser = vi.fn();
  const rpc = vi.fn();
  return {
    getUser,
    rpc,
    createSupabaseServerClient: vi.fn(async () => ({ auth: { getUser }, rpc })),
    verifyCsrf: vi.fn(),
  };
});

vi.mock("@/server/supabase/server", () => ({ createSupabaseServerClient }));
vi.mock("@/server/api/csrf", () => ({
  verifyCsrf,
  configuredAppOrigin: () => "https://renoly.test",
}));

import { POST } from "./route";

const orgId = "2f66bf0a-b8d9-4722-9e2a-23f218f25d86";
const id = "80000000-0000-4000-8000-000000000001";
const customerId = "40000000-0000-4000-8000-000000000001";

function makeRequest(body: unknown, headers: Record<string, string> = {}) {
  return new Request(
    `https://renoly.test/api/v2/organizations/${orgId}/service-requests/${id}/actions/triage`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "if-match": '"1"',
        origin: "https://renoly.test",
        "x-csrf-token": "x".repeat(43),
        ...headers,
      },
      body: JSON.stringify(body),
    },
  );
}

const params = { params: Promise.resolve({ orgId, id }) };

describe("POST .../service-requests/:id/actions/triage", () => {
  afterEach(() => {
    vi.clearAllMocks();
    verifyCsrf.mockReset();
  });

  it("triages and returns the updated detail DTO", async () => {
    getUser.mockResolvedValue({ data: { user: { id: crypto.randomUUID() } }, error: null });
    rpc.mockResolvedValue({
      data: {
        id,
        status: "triaged",
        priority: "high",
        category: "waterproofing",
        customer_id: customerId,
        location_id: null,
        asset_id: null,
        assigned_member_id: null,
        triaged_at: "2026-07-17T00:00:00.000Z",
        converted_at: null,
        converted_project_id: null,
        converted_work_order_id: null,
        lock_version: 2,
        updated_at: "2026-07-17T00:00:00.000Z",
      },
      error: null,
    });

    const response = await POST(
      makeRequest({
        customerId,
        priority: "high",
        category: "waterproofing",
        internalNote: "已電話確認",
      }),
      params,
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.status).toBe("triaged");
    expect(body.data.lockVersion).toBe(2);
    expect(rpc).toHaveBeenCalledWith("triage_service_request", {
      target_org: orgId,
      target_request: id,
      expected_lock_version: 1,
      p_customer_id: customerId,
      p_location_id: null,
      p_asset_id: null,
      p_assigned_member_id: null,
      p_priority: "high",
      p_category: "waterproofing",
      p_internal_note: "已電話確認",
    });
  });

  it("returns 428 when If-Match is missing", async () => {
    getUser.mockResolvedValue({ data: { user: { id: crypto.randomUUID() } }, error: null });

    const response = await POST(makeRequest({ customerId }, { "if-match": "" }), params);
    expect(response.status).toBe(428);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects a missing customer with 422 before the RPC", async () => {
    getUser.mockResolvedValue({ data: { user: { id: crypto.randomUUID() } }, error: null });

    const response = await POST(makeRequest({}), params);
    expect(response.status).toBe(422);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("maps a FORBIDDEN RPC error to 403", async () => {
    getUser.mockResolvedValue({ data: { user: { id: crypto.randomUUID() } }, error: null });
    rpc.mockResolvedValue({ data: null, error: { message: "FORBIDDEN" } });

    const response = await POST(makeRequest({ customerId }), params);
    expect(response.status).toBe(403);
  });

  it("maps a STALE_VERSION RPC error to 412", async () => {
    getUser.mockResolvedValue({ data: { user: { id: crypto.randomUUID() } }, error: null });
    rpc.mockResolvedValue({ data: null, error: { message: "STALE_VERSION" } });

    const response = await POST(makeRequest({ customerId }), params);
    expect(response.status).toBe(412);
  });

  it("rejects when CSRF verification fails", async () => {
    const { ApiProblem } = await import("@/server/api/problem");
    verifyCsrf.mockImplementation(() => {
      throw new ApiProblem({ status: 403, code: "CSRF_INVALID", title: "x", detail: "y" });
    });
    getUser.mockResolvedValue({ data: { user: { id: crypto.randomUUID() } }, error: null });

    const response = await POST(makeRequest({ customerId }), params);
    expect(response.status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("requires a session", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: { message: "no" } });

    const response = await POST(makeRequest({ customerId }), params);
    expect(response.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });
});
