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

function envelope(replayed: boolean) {
  return {
    serviceRequest: {
      id,
      status: "converted",
      lockVersion: 3,
      convertedAt: "2026-07-18T00:00:00.000Z",
    },
    project: null,
    workOrder: {
      id: "90000000-0000-4000-8000-000000000001",
      workOrderNo: "WO-202607-000001",
      title: "分離式冷氣清洗",
      status: "draft",
    },
    replayed,
  };
}

function makeRequest(body: unknown, headers: Record<string, string> = {}) {
  return new Request(
    `https://renoly.test/api/v2/organizations/${orgId}/service-requests/${id}/actions/convert`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "if-match": '"2"',
        "idempotency-key": "convert-abc-123456",
        origin: "https://renoly.test",
        "x-csrf-token": "x".repeat(43),
        ...headers,
      },
      body: JSON.stringify(body),
    },
  );
}

const params = { params: Promise.resolve({ orgId, id }) };

describe("POST .../service-requests/:id/actions/convert", () => {
  afterEach(() => {
    vi.clearAllMocks();
    verifyCsrf.mockReset();
  });

  it("converts and returns 201 with the conversion envelope", async () => {
    getUser.mockResolvedValue({ data: { user: { id: crypto.randomUUID() } }, error: null });
    rpc.mockResolvedValue({ data: envelope(false), error: null });

    const response = await POST(makeRequest({ mode: "singleVisit" }), params);

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.data.serviceRequest.status).toBe("converted");
    expect(body.data.workOrder.workOrderNo).toBe("WO-202607-000001");
    expect(rpc).toHaveBeenCalledWith("convert_service_request", {
      target_org: orgId,
      target_request: id,
      expected_lock_version: 2,
      p_mode: "singleVisit",
      p_project_title: null,
      p_work_order: null,
      target_idempotency_key: "convert-abc-123456",
    });
  });

  it("passes project title and work order through to the RPC", async () => {
    getUser.mockResolvedValue({ data: { user: { id: crypto.randomUUID() } }, error: null });
    rpc.mockResolvedValue({ data: envelope(false), error: null });

    await POST(
      makeRequest({
        mode: "project",
        projectTitle: "防水工程",
        workOrder: { title: "勘查" },
      }),
      params,
    );

    expect(rpc).toHaveBeenCalledWith(
      "convert_service_request",
      expect.objectContaining({
        p_mode: "project",
        p_project_title: "防水工程",
        p_work_order: { title: "勘查" },
      }),
    );
  });

  it("returns 428 when If-Match is missing", async () => {
    getUser.mockResolvedValue({ data: { user: { id: crypto.randomUUID() } }, error: null });

    const response = await POST(makeRequest({ mode: "singleVisit" }, { "if-match": "" }), params);
    expect(response.status).toBe(428);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("returns 400 when Idempotency-Key is missing", async () => {
    getUser.mockResolvedValue({ data: { user: { id: crypto.randomUUID() } }, error: null });

    const response = await POST(
      makeRequest({ mode: "singleVisit" }, { "idempotency-key": "" }),
      params,
    );
    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("maps a unique_violation convert race to 409", async () => {
    getUser.mockResolvedValue({ data: { user: { id: crypto.randomUUID() } }, error: null });
    rpc.mockResolvedValue({ data: null, error: { code: "23505", message: "duplicate key" } });

    const response = await POST(makeRequest({ mode: "singleVisit" }), params);
    expect(response.status).toBe(409);
  });

  it("still returns 201 on an idempotent replay envelope", async () => {
    getUser.mockResolvedValue({ data: { user: { id: crypto.randomUUID() } }, error: null });
    rpc.mockResolvedValue({ data: envelope(true), error: null });

    const response = await POST(makeRequest({ mode: "singleVisit" }), params);
    expect(response.status).toBe(201);
    expect((await response.json()).data.replayed).toBe(true);
  });

  it("requires a session", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: { message: "no" } });

    const response = await POST(makeRequest({ mode: "singleVisit" }), params);
    expect(response.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });
});
