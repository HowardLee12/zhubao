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

function detail(overrides: Record<string, unknown> = {}) {
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
    completionSummary: null,
    priority: "normal",
    status: "en_route",
    scheduledStartAt: "2026-08-01T01:00:00+00:00",
    scheduledEndAt: "2026-08-01T03:00:00+00:00",
    dispatchedAt: null,
    enRouteAt: "2026-08-01T01:30:00+00:00",
    onSiteAt: null,
    pausedAt: null,
    completedAt: null,
    cancelledAt: null,
    cancellationReason: null,
    requiresCustomerSignoff: false,
    customerSignedAt: null,
    lockVersion: 3,
    createdAt: "2026-07-19T00:00:00+00:00",
    updatedAt: "2026-08-01T01:30:00+00:00",
    assignments: [
      { id: "a0000000-0000-4000-8000-000000000001", membershipId: "30000000-0000-4000-8000-000000000003",
        memberName: "技師", duty: "lead", status: "accepted",
        assignedAt: null, acceptedAt: null, declinedAt: null, checkedInAt: null,
        completedAt: null, cancelledAt: null, declineReason: null, lockVersion: 1 },
    ],
    checklists: [],
    photos: [],
    ...overrides,
  };
}

function transitionResult(status: string, lockVersion: number) {
  return { id: WO, workOrderNo: "W-2026-0002", status, lockVersion };
}

function request(body: unknown, occurredAt = new Date(Date.now() - 60_000).toISOString()): Request {
  return new Request(
    `http://localhost/api/v2/organizations/${ORG}/work-orders/${WO}/actions/transition`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost",
        cookie: `renoly-csrf=${csrf}`,
        "x-csrf-token": csrf,
        "if-match": '"3"',
      },
      body: JSON.stringify({ occurredAt, ...(body as object) }),
    },
  );
}

describe("transition action route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createSupabaseServerClient.mockResolvedValue({
      rpc: mocks.rpc,
      auth: { getUser: mocks.getUser },
    });
    mocks.getUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
  });

  it("pre-checks then transitions en_route -> on_site (arrive)", async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: detail(), error: null })
      .mockResolvedValueOnce({ data: transitionResult("on_site", 4), error: null });
    const response = await POST(request({ action: "arrive" }), {
      params: Promise.resolve({ orgId: ORG, id: WO }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.status).toBe("on_site");
    expect(body.notification.status).toBe("not_sent");
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, "transition_work_order_safe", expect.objectContaining({
      target_status: "on_site",
      expected_lock_version: 3,
    }));
  });

  it("blocks completion with a missing after photo before the write (422)", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: detail({
        status: "on_site",
        checklists: [],
        photos: [{
          id: "90000000-0000-4000-8000-000000000001", category: "before", status: "ready",
          checklistItemId: null, storagePath: "p", mimeType: "image/jpeg", byteSize: 1,
          width: 1, height: 1, sha256: null, caption: null, capturedAt: null,
          uploadedByMembershipId: null, readyAt: null, lockVersion: 1,
          createdAt: "2026-08-01T02:00:00+00:00",
        }],
      }),
      error: null,
    });
    const recentOccurredAt = new Date(Date.now() - 60_000).toISOString();
    const response = await POST(
      request({ action: "complete", completionSummary: "已完工" }, recentOccurredAt),
      { params: Promise.resolve({ orgId: ORG, id: WO }) },
    );
    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.detail).toContain("afterPhoto");
    // Only the detail read happened; no write.
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });

  it("rejects the schedule action (own route)", async () => {
    const response = await POST(request({ action: "schedule" }), {
      params: Promise.resolve({ orgId: ORG, id: WO }),
    });
    expect(response.status).toBe(422);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
