import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  getUser: vi.fn(),
  createSupabaseServerClient: vi.fn(),
}));

vi.mock("@/server/supabase/server", () => ({
  createSupabaseServerClient: mocks.createSupabaseServerClient,
}));

import { GET, POST } from "./route";

const ORG = "20000000-0000-4000-8000-000000000001";
const WO = "82060000-0000-4000-8000-000000000001";
const MEMBER = "30000000-0000-4000-8000-000000000003";
const ASSIGNMENT = "a0000000-0000-4000-8000-000000000001";
const csrf = "csrf-token-value-0123456789-abcdefghij";

function assignmentDto() {
  return {
    id: ASSIGNMENT,
    organizationId: ORG,
    workOrderId: WO,
    membershipId: MEMBER,
    duty: "lead",
    status: "assigned",
    assignedAt: "2026-08-01T00:00:00+00:00",
    acceptedAt: null,
    declinedAt: null,
    checkedInAt: null,
    completedAt: null,
    cancelledAt: null,
    declineReason: null,
    lockVersion: 1,
  };
}

function detailWithAssignments() {
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
    internalNotes: null,
    completionSummary: null,
    priority: "normal",
    status: "scheduled",
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
    lockVersion: 2,
    createdAt: "2026-07-19T00:00:00+00:00",
    updatedAt: "2026-07-19T00:00:00+00:00",
    assignments: [
      {
        id: ASSIGNMENT,
        membershipId: MEMBER,
        memberName: "王師傅",
        duty: "lead",
        status: "assigned",
        assignedAt: "2026-08-01T00:00:00+00:00",
        acceptedAt: null,
        declinedAt: null,
        checkedInAt: null,
        completedAt: null,
        cancelledAt: null,
        declineReason: null,
        lockVersion: 1,
      },
    ],
    checklists: [],
    photos: [],
  };
}

function postRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost/api/v2/organizations/${ORG}/work-orders/${WO}/assignments`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost",
      cookie: `renoly-csrf=${csrf}`,
      "x-csrf-token": csrf,
      "idempotency-key": "assign-create-key-1",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

const params = { params: Promise.resolve({ orgId: ORG, id: WO }) };

describe("work-order assignments collection route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createSupabaseServerClient.mockResolvedValue({
      rpc: mocks.rpc,
      auth: { getUser: mocks.getUser },
    });
    mocks.getUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
  });

  it("GET derives the roster from the detail projection", async () => {
    mocks.rpc.mockResolvedValue({ data: detailWithAssignments(), error: null });

    const response = await GET(
      new Request(`http://localhost/api/v2/organizations/${ORG}/work-orders/${WO}/assignments`),
      params,
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].membershipId).toBe(MEMBER);
    expect(mocks.rpc).toHaveBeenCalledWith("get_work_order_detail", {
      target_org: ORG,
      target_work_order: WO,
    });
  });

  it("GET requires authentication", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });

    const response = await GET(
      new Request(`http://localhost/api/v2/organizations/${ORG}/work-orders/${WO}/assignments`),
      params,
    );

    expect(response.status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("GET rejects a malformed work-order id", async () => {
    const response = await GET(
      new Request(`http://localhost/api/v2/organizations/${ORG}/work-orders/x/assignments`),
      { params: Promise.resolve({ orgId: ORG, id: "x" }) },
    );

    expect(response.status).toBe(422);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("POST creates an assignment and returns 201 with an ETag", async () => {
    mocks.rpc.mockResolvedValue({ data: assignmentDto(), error: null });

    const response = await POST(postRequest({ membershipId: MEMBER, duty: "lead" }), params);

    expect(response.status).toBe(201);
    expect(response.headers.get("etag")).toBe('"1"');
    expect(mocks.rpc).toHaveBeenCalledWith(
      "create_assignment",
      expect.objectContaining({
        target_org: ORG,
        target_work_order: WO,
        p_membership_id: MEMBER,
        p_duty: "lead",
        p_idempotency_key: "assign-create-key-1",
      }),
    );
  });

  it("POST returns 200 on an idempotent replay envelope", async () => {
    mocks.rpc.mockResolvedValue({ data: { ...assignmentDto(), replayed: true }, error: null });

    const response = await POST(postRequest({ membershipId: MEMBER, duty: "lead" }), params);

    expect(response.status).toBe(200);
  });

  it("POST fails CSRF when the double-submit token is absent", async () => {
    const response = await POST(
      postRequest({ membershipId: MEMBER, duty: "lead" }, { "x-csrf-token": "", cookie: "" }),
      params,
    );

    expect(response.status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("POST requires an idempotency key", async () => {
    const response = await POST(
      postRequest({ membershipId: MEMBER, duty: "lead" }, { "idempotency-key": "" }),
      params,
    );

    expect(response.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("POST rejects an invalid duty with a 422", async () => {
    const response = await POST(postRequest({ membershipId: MEMBER, duty: "boss" }), params);

    expect(response.status).toBe(422);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("POST maps an assignment-limit RPC error to 409", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: "ASSIGNMENT_LIMIT_EXCEEDED" },
    });

    const response = await POST(postRequest({ membershipId: MEMBER, duty: "lead" }), params);

    expect(response.status).toBe(409);
  });

  it("GET returns 500 when the detail projection fails its contract", async () => {
    mocks.rpc.mockResolvedValue({ data: { id: WO }, error: null });

    const response = await GET(
      new Request(`http://localhost/api/v2/organizations/${ORG}/work-orders/${WO}/assignments`),
      params,
    );

    expect(response.status).toBe(500);
  });

  it("POST returns 500 when the created assignment fails its contract", async () => {
    mocks.rpc.mockResolvedValue({ data: { id: ASSIGNMENT }, error: null });

    const response = await POST(postRequest({ membershipId: MEMBER, duty: "lead" }), params);

    expect(response.status).toBe(500);
  });

  it("GET collapses an unexpected non-problem error into a 500", async () => {
    mocks.createSupabaseServerClient.mockRejectedValueOnce(new Error("boom"));

    const response = await GET(
      new Request(`http://localhost/api/v2/organizations/${ORG}/work-orders/${WO}/assignments`),
      params,
    );

    expect(response.status).toBe(500);
  });

  it("GET rejects a malformed org id", async () => {
    const response = await GET(
      new Request(`http://localhost/api/v2/organizations/bad/work-orders/${WO}/assignments`),
      { params: Promise.resolve({ orgId: "bad", id: WO }) },
    );

    expect(response.status).toBe(422);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("POST requires authentication after CSRF, idempotency and validation gates", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });

    const response = await POST(postRequest({ membershipId: MEMBER, duty: "lead" }), params);

    expect(response.status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("POST rejects a malformed work-order id", async () => {
    const response = await POST(postRequest({ membershipId: MEMBER, duty: "lead" }), {
      params: Promise.resolve({ orgId: ORG, id: "x" }),
    });

    expect(response.status).toBe(422);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
