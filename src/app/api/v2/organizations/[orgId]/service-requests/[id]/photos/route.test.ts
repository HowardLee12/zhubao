import { afterEach, describe, expect, it, vi } from "vitest";

const { rpc, createSupabaseServerClient, signPhotos, authorize } = vi.hoisted(() => {
  const rpc = vi.fn();
  return {
    rpc,
    createSupabaseServerClient: vi.fn(async () => ({ rpc })),
    signPhotos: vi.fn(),
    authorize: vi.fn(async () => ({ userId: "u1" })),
  };
});

vi.mock("@/server/supabase/server", () => ({ createSupabaseServerClient }));
vi.mock("@/server/api/org-authorization", () => ({ authorizeOrgManager: authorize }));
vi.mock("@/server/api/service-request-photos", () => ({ signServiceRequestPhotos: signPhotos }));

import { GET } from "./route";

const orgId = "20000000-0000-4000-8000-000000000001";
const id = "80000000-0000-4000-8000-000000000001";
const params = { params: Promise.resolve({ orgId, id }) };

function workspace() {
  return {
    request: {
      id,
      request_no: "SR-202607-000001",
      customer_id: null,
      location_id: null,
      asset_id: null,
      source: "web",
      status: "new",
      priority: "normal",
      category: null,
      subject: "浴室牆面滲水",
      description: "",
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
      original_submission: null,
      summary_edited_by: null,
      summary_edited_at: null,
      lock_version: 1,
      created_at: "2026-07-16T10:00:00.000Z",
      updated_at: "2026-07-16T10:00:00.000Z",
    },
    windows: [],
    photos: [
      {
        id: "a0000000-0000-4000-8000-000000000001",
        category: "intake",
        storage_path: "org/private/photo",
      },
    ],
  };
}

describe("GET .../service-requests/:id/photos", () => {
  afterEach(() => {
    vi.clearAllMocks();
    authorize.mockResolvedValue({ userId: "u1" });
  });

  it("authorizes photo metadata by RPC before asking the storage signer", async () => {
    rpc.mockResolvedValueOnce({ data: workspace(), error: null });
    signPhotos.mockResolvedValue([
      {
        id: "a0000000-0000-4000-8000-000000000001",
        category: "intake",
        url: "https://signed.example/photo",
        expiresAt: "2026-07-18T00:05:00.000Z",
      },
    ]);

    const response = await GET(new Request("https://renoly.test/x"), params);
    expect(response.status).toBe(200);
    expect((await response.json()).data[0].url).toBe("https://signed.example/photo");
    expect(signPhotos).toHaveBeenCalledWith(workspace().photos);
    expect(rpc).toHaveBeenCalledWith("get_pilot_service_request_detail", {
      p_organization_id: orgId,
      p_service_request_id: id,
    });
  });

  it("propagates a 403 without reading or signing photo metadata", async () => {
    const { ApiProblem } = await import("@/server/api/problem");
    authorize.mockRejectedValueOnce(
      new ApiProblem({ status: 403, code: "FORBIDDEN", title: "x", detail: "y" }),
    );

    const response = await GET(new Request("https://renoly.test/x"), params);
    expect(response.status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
    expect(signPhotos).not.toHaveBeenCalled();
  });
});
