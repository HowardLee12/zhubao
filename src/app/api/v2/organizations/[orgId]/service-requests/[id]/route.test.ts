import { afterEach, describe, expect, it, vi } from "vitest";

const { createSupabaseServerClient, rpc, verifyCsrf, signPhotos, authorize } =
  vi.hoisted(() => {
    const rpc = vi.fn();
    return {
      rpc,
      createSupabaseServerClient: vi.fn(async () => ({ rpc })),
      verifyCsrf: vi.fn(),
      signPhotos: vi.fn(async () => []),
      authorize: vi.fn(async () => ({
        userId: "10000000-0000-4000-8000-000000000002",
      })),
    };
  });

vi.mock("@/server/supabase/server", () => ({ createSupabaseServerClient }));
vi.mock("@/server/api/org-authorization", () => ({ authorizeOrgManager: authorize }));
vi.mock("@/server/api/csrf", () => ({
  verifyCsrf,
  configuredAppOrigin: () => "https://renoly.test",
}));
vi.mock("@/server/api/service-request-photos", () => ({
  signServiceRequestPhotos: signPhotos,
}));

import { GET, PATCH } from "./route";

const orgId = "20000000-0000-4000-8000-000000000001";
const id = "80000000-0000-4000-8000-000000000001";

function detailRow(overrides: Record<string, unknown> = {}) {
  return {
    id,
    request_no: "SR-202607-000001",
    customer_id: "40000000-0000-4000-8000-000000000001",
    location_id: "50000000-0000-4000-8000-000000000001",
    asset_id: null,
    source: "web",
    status: "new",
    priority: "normal",
    category: null,
    subject: "浴室牆面滲水",
    description: "下雨後有水痕",
    contact_name: "王先生",
    contact_phone: "+886912345678",
    contact_email: null,
    assigned_member_id: null,
    triaged_at: null,
    converted_at: null,
    converted_project_id: null,
    converted_work_order_id: null,
    converted_project_no: null,
    converted_work_order_no: null,
    decline_reason: null,
    cancellation_reason: null,
    internal_note: "",
    original_submission: { subject: "浴室牆面滲水" },
    summary_edited_by: null,
    summary_edited_at: null,
    lock_version: 1,
    created_at: "2026-07-16T10:00:00.000Z",
    updated_at: "2026-07-16T10:00:00.000Z",
    ...overrides,
  };
}

function workspace(overrides: Record<string, unknown> = {}) {
  return {
    request: detailRow(overrides),
    windows: [
      {
        starts_at: "2026-08-10T01:00:00.000Z",
        ends_at: "2026-08-10T04:00:00.000Z",
        preference_rank: 1,
      },
    ],
    photos: [],
  };
}

const params = { params: Promise.resolve({ orgId, id }) };

describe("GET .../service-requests/:id", () => {
  afterEach(() => {
    vi.clearAllMocks();
    signPhotos.mockResolvedValue([]);
    authorize.mockResolvedValue({
      userId: "10000000-0000-4000-8000-000000000002",
    });
  });

  it("returns the authenticated RPC detail with an ETag", async () => {
    rpc.mockResolvedValueOnce({ data: workspace(), error: null });

    const response = await GET(new Request("https://renoly.test/x"), params);

    expect(response.status).toBe(200);
    expect(response.headers.get("etag")).toBe('"1"');
    expect(rpc).toHaveBeenCalledWith("get_pilot_service_request_detail", {
      p_organization_id: orgId,
      p_service_request_id: id,
    });
    const body = await response.json();
    expect(body.data.subject).toBe("浴室牆面滲水");
    expect(body.data.title).toBe("浴室牆面滲水");
    expect(body.data.preferredWindows).toHaveLength(1);
  });

  it("maps the RPC's non-leaky missing signal to 404", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "SERVICE_REQUEST_NOT_FOUND" } });

    const response = await GET(new Request("https://renoly.test/x"), params);
    expect(response.status).toBe(404);
  });

  it("propagates a 403 from the authorization gate without calling data RPCs", async () => {
    const { ApiProblem } = await import("@/server/api/problem");
    authorize.mockRejectedValueOnce(
      new ApiProblem({ status: 403, code: "FORBIDDEN", title: "x", detail: "y" }),
    );

    const response = await GET(new Request("https://renoly.test/x"), params);
    expect(response.status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });
});

function patchRequest(body: unknown, headers: Record<string, string> = {}) {
  return new Request("https://renoly.test/x", {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      "if-match": '"1"',
      origin: "https://renoly.test",
      "x-csrf-token": "x".repeat(43),
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

describe("PATCH .../service-requests/:id", () => {
  afterEach(() => {
    vi.clearAllMocks();
    signPhotos.mockResolvedValue([]);
    authorize.mockResolvedValue({
      userId: "10000000-0000-4000-8000-000000000002",
    });
  });

  it("updates through the audited RPC and returns the complete workspace", async () => {
    rpc.mockResolvedValueOnce({
      data: workspace({
        subject: "浴室牆面嚴重滲水",
        lock_version: 2,
        summary_edited_by: "10000000-0000-4000-8000-000000000002",
        summary_edited_at: "2026-07-19T10:00:00.000Z",
      }),
      error: null,
    });

    const response = await PATCH(patchRequest({ subject: "浴室牆面嚴重滲水" }), params);

    expect(response.status).toBe(200);
    expect(response.headers.get("etag")).toBe('"2"');
    expect((await response.json()).data.preferredWindows).toHaveLength(1);
    expect(rpc).toHaveBeenCalledWith(
      "update_pilot_service_request_summary",
      expect.objectContaining({
        p_organization_id: orgId,
        p_service_request_id: id,
        p_expected_lock_version: 1,
        p_patch: { subject: "浴室牆面嚴重滲水" },
        p_request_id: expect.any(String),
      }),
    );
  });

  it("maps the deprecated title alias onto the canonical RPC subject", async () => {
    rpc.mockResolvedValueOnce({ data: workspace({ subject: "新標題", lock_version: 2 }), error: null });

    await PATCH(patchRequest({ title: "新標題" }), params);

    expect(rpc).toHaveBeenCalledWith(
      "update_pilot_service_request_summary",
      expect.objectContaining({ p_patch: { subject: "新標題" } }),
    );
  });

  it("maps a stale RPC update to 412", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "STALE_VERSION" } });
    const response = await PATCH(patchRequest({ subject: "x" }), params);
    expect(response.status).toBe(412);
  });

  it("maps a missing RPC update to 404", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "SERVICE_REQUEST_NOT_FOUND" } });
    const response = await PATCH(patchRequest({ subject: "x" }), params);
    expect(response.status).toBe(404);
  });

  it("returns 428 without If-Match", async () => {
    const response = await PATCH(patchRequest({ subject: "x" }, { "if-match": "" }), params);
    expect(response.status).toBe(428);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects an empty body with 422", async () => {
    const response = await PATCH(patchRequest({}), params);
    expect(response.status).toBe(422);
    expect(rpc).not.toHaveBeenCalled();
  });
});
