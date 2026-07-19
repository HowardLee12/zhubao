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
const MEMBER = "30000000-0000-4000-8000-000000000003";
const csrf = "csrf-token-value-0123456789-abcdefghij";

const validBody = {
  scheduledStartAt: "2026-08-01T01:00:00+00:00",
  scheduledEndAt: "2026-08-01T03:00:00+00:00",
  occurredAt: "2026-08-01T00:30:00+00:00",
  assignments: [{ membershipId: MEMBER, duty: "lead" }],
};

function scheduledDetail() {
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
    status: "scheduled",
    scheduledStartAt: validBody.scheduledStartAt,
    scheduledEndAt: validBody.scheduledEndAt,
    dispatchedAt: null,
    enRouteAt: null,
    onSiteAt: null,
    pausedAt: null,
    completedAt: null,
    cancelledAt: null,
    cancellationReason: null,
    requiresCustomerSignoff: false,
    customerSignedAt: null,
    lockVersion: 2,
    createdAt: "2026-07-19T00:00:00+00:00",
    updatedAt: "2026-08-01T00:30:00+00:00",
    assignments: [],
    checklists: [],
    photos: [],
  };
}

function request(body: unknown = validBody, headers: Record<string, string> = {}): Request {
  return new Request(
    `http://localhost/api/v2/organizations/${ORG}/work-orders/${WO}/actions/schedule`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost",
        cookie: `renoly-csrf=${csrf}`,
        "x-csrf-token": csrf,
        "if-match": '"1"',
        ...headers,
      },
      body: JSON.stringify(body),
    },
  );
}

describe("schedule action route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createSupabaseServerClient.mockResolvedValue({
      rpc: mocks.rpc,
      auth: { getUser: mocks.getUser },
    });
    mocks.getUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
  });

  it("schedules atomically and surfaces the honest LINE notification", async () => {
    mocks.rpc.mockResolvedValue({ data: scheduledDetail(), error: null });
    const response = await POST(request(), {
      params: Promise.resolve({ orgId: ORG, id: WO }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.status).toBe("scheduled");
    expect(body.notification).toEqual({
      status: "not_sent",
      reason: "line_delivery_deferred_to_m6",
    });
    expect(mocks.rpc).toHaveBeenCalledWith("schedule_work_order", expect.objectContaining({
      p_expected_lock_version: 1,
      p_assignments: validBody.assignments,
    }));
  });

  it("returns a 409 with conflicts[] on a schedule conflict", async () => {
    const conflicts = [
      {
        membershipId: MEMBER,
        workOrderId: WO,
        workOrderNo: "W-2026-0001",
        startsAt: "2026-08-01T01:30:00+00:00",
        endsAt: "2026-08-01T02:30:00+00:00",
      },
    ];
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: "SCHEDULE_CONFLICT", details: JSON.stringify(conflicts) },
    });
    const response = await POST(request(), {
      params: Promise.resolve({ orgId: ORG, id: WO }),
    });
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.code).toBe("SCHEDULE_CONFLICT");
    expect(body.conflicts).toEqual(conflicts);
  });

  it("requires If-Match", async () => {
    const response = await POST(request(validBody, { "if-match": "" }), {
      params: Promise.resolve({ orgId: ORG, id: WO }),
    });
    expect(response.status).toBe(428);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
