import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  getUser: vi.fn(),
  createSupabaseServerClient: vi.fn(),
}));

vi.mock("@/server/supabase/server", () => ({
  createSupabaseServerClient: mocks.createSupabaseServerClient,
}));

import { GET } from "./route";

const ORG = "20000000-0000-4000-8000-000000000001";
const WO = "82060000-0000-4000-8000-000000000001";

function detailFixture() {
  return {
    id: WO,
    organizationId: ORG,
    workOrderNo: "W-2026-0099",
    projectId: null,
    serviceRequestId: null,
    customerId: "40000000-0000-4000-8000-000000000001",
    locationId: "50000000-0000-4000-8000-000000000001",
    assetId: null,
    title: "冷氣清洗",
    description: null,
    customerNotes: null,
    technicianNotes: null,
    internalNotes: "成本備註",
    completionSummary: null,
    priority: "normal",
    status: "draft",
    scheduledStartAt: null,
    scheduledEndAt: null,
    dispatchedAt: null,
    enRouteAt: null,
    onSiteAt: null,
    pausedAt: null,
    completedAt: null,
    cancelledAt: null,
    cancellationReason: null,
    requiresCustomerSignoff: false,
    customerSignedAt: null,
    lockVersion: 3,
    createdAt: "2026-07-19T00:00:00+00:00",
    updatedAt: "2026-07-19T00:00:00+00:00",
    assignments: [],
    checklists: [],
    photos: [
      {
        id: "90000000-0000-4000-8000-000000000001",
        category: "before",
        status: "ready",
        checklistItemId: null,
        storagePath: "org/x/work-orders/w/p/upload",
        mimeType: "image/jpeg",
        byteSize: 100,
        width: 10,
        height: 10,
        sha256: "a".repeat(64),
        caption: null,
        capturedAt: null,
        uploadedByMembershipId: null,
        readyAt: "2026-07-19T00:00:00+00:00",
        lockVersion: 2,
        createdAt: "2026-07-19T00:00:00+00:00",
      },
    ],
  };
}

function getRequest(): Request {
  return new Request(`http://localhost/api/v2/organizations/${ORG}/work-orders/${WO}`);
}

const params = { params: Promise.resolve({ orgId: ORG, id: WO }) };

describe("work-order detail route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createSupabaseServerClient.mockResolvedValue({
      rpc: mocks.rpc,
      auth: { getUser: mocks.getUser },
    });
    mocks.getUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
  });

  it("returns the detail with an ETag and stripped storage paths", async () => {
    mocks.rpc.mockResolvedValue({ data: detailFixture(), error: null });

    const response = await GET(getRequest(), params);

    expect(response.status).toBe(200);
    expect(response.headers.get("etag")).toBe('"3"');
    const body = await response.json();
    expect(body.data.photos[0].storagePath).toBe("");
    expect(mocks.rpc).toHaveBeenCalledWith("get_work_order_detail", {
      target_org: ORG,
      target_work_order: WO,
    });
  });

  it("requires authentication", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });

    const response = await GET(getRequest(), params);

    expect(response.status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rejects a malformed work-order id before the RPC", async () => {
    const response = await GET(getRequest(), {
      params: Promise.resolve({ orgId: ORG, id: "not-a-uuid" }),
    });

    expect(response.status).toBe(422);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rejects a malformed org id before the RPC", async () => {
    const response = await GET(getRequest(), {
      params: Promise.resolve({ orgId: "bad", id: WO }),
    });

    expect(response.status).toBe(422);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("collapses a not-found / cross-tenant RPC error to a non-leaky 404", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: "WORK_ORDER_NOT_FOUND" },
    });

    const response = await GET(getRequest(), params);

    expect(response.status).toBe(404);
  });

  it("returns 500 when the RPC payload fails the detail contract", async () => {
    mocks.rpc.mockResolvedValue({ data: { id: WO }, error: null });

    const response = await GET(getRequest(), params);

    expect(response.status).toBe(500);
  });

  it("collapses an unexpected non-problem error into a 500", async () => {
    mocks.createSupabaseServerClient.mockRejectedValueOnce(new Error("boom"));

    const response = await GET(getRequest(), params);

    expect(response.status).toBe(500);
  });
});
