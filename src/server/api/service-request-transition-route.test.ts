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

import { createTransitionRoute } from "./service-request-transition-route";

const orgId = "2f66bf0a-b8d9-4722-9e2a-23f218f25d86";
const id = "80000000-0000-4000-8000-000000000001";

function okRow(status: string, lockVersion: number) {
  return {
    id,
    status,
    priority: "normal",
    category: null,
    customer_id: "40000000-0000-4000-8000-000000000001",
    location_id: null,
    asset_id: null,
    assigned_member_id: null,
    triaged_at: "2026-07-17T00:00:00.000Z",
    converted_at: null,
    converted_project_id: null,
    converted_work_order_id: null,
    lock_version: lockVersion,
    updated_at: "2026-07-17T00:00:00.000Z",
  };
}

function makeRequest(body: unknown, headers: Record<string, string> = {}) {
  return new Request(
    `https://renoly.test/api/v2/organizations/${orgId}/service-requests/${id}/actions/x`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "if-match": '"2"',
        origin: "https://renoly.test",
        "x-csrf-token": "x".repeat(43),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
  );
}

const params = { params: Promise.resolve({ orgId, id }) };

describe("createTransitionRoute", () => {
  afterEach(() => {
    vi.clearAllMocks();
    verifyCsrf.mockReset();
  });

  it("start-quoting transitions without requiring a reason body", async () => {
    getUser.mockResolvedValue({ data: { user: { id: crypto.randomUUID() } }, error: null });
    rpc.mockResolvedValue({ data: okRow("quoting", 3), error: null });

    const POST = createTransitionRoute("quoting");
    const response = await POST(makeRequest(undefined), params);

    expect(response.status).toBe(200);
    expect((await response.json()).data.status).toBe("quoting");
    expect(rpc).toHaveBeenCalledWith("transition_service_request", {
      target_org: orgId,
      target_request: id,
      target_status: "quoting",
      expected_lock_version: 2,
      reason: null,
    });
  });

  it("decline forwards a required reason to the RPC", async () => {
    getUser.mockResolvedValue({ data: { user: { id: crypto.randomUUID() } }, error: null });
    rpc.mockResolvedValue({ data: okRow("declined", 3), error: null });

    const POST = createTransitionRoute("declined");
    const response = await POST(makeRequest({ reason: "不在服務範圍" }), params);

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith(
      "transition_service_request",
      expect.objectContaining({ target_status: "declined", reason: "不在服務範圍" }),
    );
  });

  it("decline rejects a missing reason with 422", async () => {
    getUser.mockResolvedValue({ data: { user: { id: crypto.randomUUID() } }, error: null });

    const POST = createTransitionRoute("cancelled");
    const response = await POST(makeRequest({}), params);

    expect(response.status).toBe(422);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("returns 428 without If-Match", async () => {
    getUser.mockResolvedValue({ data: { user: { id: crypto.randomUUID() } }, error: null });

    const POST = createTransitionRoute("quoting");
    const response = await POST(makeRequest(undefined, { "if-match": "" }), params);

    expect(response.status).toBe(428);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("maps INVALID_SERVICE_REQUEST_TRANSITION to 409", async () => {
    getUser.mockResolvedValue({ data: { user: { id: crypto.randomUUID() } }, error: null });
    rpc.mockResolvedValue({
      data: null,
      error: { message: "INVALID_SERVICE_REQUEST_TRANSITION" },
    });

    const POST = createTransitionRoute("quoted");
    const response = await POST(makeRequest(undefined), params);

    expect(response.status).toBe(409);
  });

  it("requires a session", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: { message: "no" } });

    const POST = createTransitionRoute("quoting");
    const response = await POST(makeRequest(undefined), params);

    expect(response.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });
});
