import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  getUser: vi.fn(),
  createSupabaseServerClient: vi.fn(),
}));

vi.mock("@/server/supabase/server", () => ({
  createSupabaseServerClient: mocks.createSupabaseServerClient,
}));

import { POST } from "./route";

const ORG = "20000000-0000-4000-8000-000000000001";
const WO = "82060000-0000-4000-8000-000000000001";
const csrf = "csrf-token-value-0123456789-abcdefghij";

function completedDetail() {
  return {
    id: WO,
    organizationId: ORG,
    workOrderNo: "W-2026-0002",
    projectId: null,
    serviceRequestId: null,
    customerId: "40000000-0000-4000-8000-000000000001",
    locationId: "50000000-0000-4000-8000-000000000001",
    assetId: null,
    title: "冷氣清洗",
    description: null,
    customerNotes: null,
    technicianNotes: null,
    internalNotes: null,
    completionSummary: "老闆例外完工",
    priority: "normal",
    status: "completed",
    scheduledStartAt: null,
    scheduledEndAt: null,
    dispatchedAt: null,
    enRouteAt: null,
    onSiteAt: null,
    pausedAt: null,
    completedAt: "2026-08-01T05:00:00+00:00",
    cancelledAt: null,
    cancellationReason: null,
    requiresCustomerSignoff: false,
    customerSignedAt: null,
    lockVersion: 6,
    createdAt: "2026-07-19T00:00:00+00:00",
    updatedAt: "2026-08-01T05:00:00+00:00",
    assignments: [],
    checklists: [],
    photos: [],
  };
}

function request(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(
    `http://localhost/api/v2/organizations/${ORG}/work-orders/${WO}/actions/force-complete`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost",
        cookie: `renoly-csrf=${csrf}`,
        "x-csrf-token": csrf,
        "if-match": '"5"',
        ...headers,
      },
      body: JSON.stringify(body),
    },
  );
}

describe("force-complete action route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createSupabaseServerClient.mockResolvedValue({
      rpc: mocks.rpc,
      auth: { getUser: mocks.getUser },
    });
    mocks.getUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
  });

  it("force-completes and never surfaces a customer sign-off", async () => {
    mocks.rpc.mockResolvedValue({ data: completedDetail(), error: null });
    const response = await POST(
      request({
        reason: "客戶要求提前結案",
        completionSummary: "老闆例外完工",
        occurredAt: "2026-08-01T05:00:00+00:00",
      }),
      { params: Promise.resolve({ orgId: ORG, id: WO }) },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.status).toBe("completed");
    expect(body.data.customerSignedAt).toBeNull();
    expect(body.notification.status).toBe("queued");
    expect(mocks.rpc).toHaveBeenCalledWith("force_complete_work_order", expect.objectContaining({
      p_reason: "客戶要求提前結案",
      p_expected_lock_version: 5,
    }));
  });

  it("maps FORCE_COMPLETE_REQUIRES_OWNER to a 403", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: "FORCE_COMPLETE_REQUIRES_OWNER" },
    });
    const response = await POST(
      request({
        reason: "x",
        completionSummary: "y",
        occurredAt: "2026-08-01T05:00:00+00:00",
      }),
      { params: Promise.resolve({ orgId: ORG, id: WO }) },
    );
    expect(response.status).toBe(403);
  });

  it("requires a reason in the body", async () => {
    const response = await POST(
      request({ completionSummary: "y", occurredAt: "2026-08-01T05:00:00+00:00" }),
      { params: Promise.resolve({ orgId: ORG, id: WO }) },
    );
    expect(response.status).toBe(422);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
