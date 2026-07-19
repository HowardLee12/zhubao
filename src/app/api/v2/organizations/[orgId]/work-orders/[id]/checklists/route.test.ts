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
const CHECKLIST = "c0000000-0000-4000-8000-000000000001";
const csrf = "csrf-token-value-0123456789-abcdefghij";

function detailWithChecklists() {
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
    status: "on_site",
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
    lockVersion: 4,
    createdAt: "2026-07-19T00:00:00+00:00",
    updatedAt: "2026-07-19T00:00:00+00:00",
    assignments: [],
    checklists: [
      {
        id: CHECKLIST,
        name: "完工檢查",
        status: "pending",
        completedAt: null,
        completedByMembershipId: null,
        lockVersion: 1,
        items: [
          {
            id: "c1000000-0000-4000-8000-000000000001",
            label: "冷媒壓力",
            responseType: "number",
            isRequired: true,
            evidenceRequired: false,
            options: null,
            response: null,
            completedAt: null,
            completedByMembershipId: null,
            sortOrder: 0,
          },
        ],
      },
    ],
    photos: [],
  };
}

function postRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost/api/v2/organizations/${ORG}/work-orders/${WO}/checklists`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost",
      cookie: `renoly-csrf=${csrf}`,
      "x-csrf-token": csrf,
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

const params = { params: Promise.resolve({ orgId: ORG, id: WO }) };
const validBody = {
  name: "完工檢查",
  items: [{ label: "冷媒壓力", responseType: "number", isRequired: true }],
};

describe("work-order checklists collection route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createSupabaseServerClient.mockResolvedValue({
      rpc: mocks.rpc,
      auth: { getUser: mocks.getUser },
    });
    mocks.getUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
  });

  it("GET derives the checklists from the detail projection", async () => {
    mocks.rpc.mockResolvedValue({ data: detailWithChecklists(), error: null });

    const response = await GET(
      new Request(`http://localhost/api/v2/organizations/${ORG}/work-orders/${WO}/checklists`),
      params,
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].name).toBe("完工檢查");
  });

  it("GET requires authentication", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });

    const response = await GET(
      new Request(`http://localhost/api/v2/organizations/${ORG}/work-orders/${WO}/checklists`),
      params,
    );

    expect(response.status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("POST creates an inline checklist and returns 201", async () => {
    mocks.rpc.mockResolvedValue({
      data: { checklistId: CHECKLIST, workOrderId: WO, name: "完工檢查" },
      error: null,
    });

    const response = await POST(postRequest(validBody), params);

    expect(response.status).toBe(201);
    expect(mocks.rpc).toHaveBeenCalledWith(
      "create_work_order_checklist",
      expect.objectContaining({
        target_org: ORG,
        target_work_order: WO,
        p_name: "完工檢查",
        p_items: validBody.items,
      }),
    );
  });

  it("POST fails CSRF when the origin does not match the app origin", async () => {
    const response = await POST(postRequest(validBody, { origin: "https://evil.example" }), params);

    expect(response.status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("POST rejects an empty item list with a 422", async () => {
    const response = await POST(postRequest({ name: "空", items: [] }), params);

    expect(response.status).toBe(422);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("POST rejects a malformed work-order id", async () => {
    const response = await POST(
      new Request(`http://localhost/api/v2/organizations/${ORG}/work-orders/x/checklists`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost",
          cookie: `renoly-csrf=${csrf}`,
          "x-csrf-token": csrf,
        },
        body: JSON.stringify(validBody),
      }),
      { params: Promise.resolve({ orgId: ORG, id: "x" }) },
    );

    expect(response.status).toBe(422);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("POST maps a not-editable RPC error to 409", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: "WORK_ORDER_NOT_EDITABLE" },
    });

    const response = await POST(postRequest(validBody), params);

    expect(response.status).toBe(409);
  });

  it("GET returns 500 when the detail projection fails its contract", async () => {
    mocks.rpc.mockResolvedValue({ data: { id: WO }, error: null });

    const response = await GET(
      new Request(`http://localhost/api/v2/organizations/${ORG}/work-orders/${WO}/checklists`),
      params,
    );

    expect(response.status).toBe(500);
  });

  it("POST returns 500 when the created checklist fails its contract", async () => {
    mocks.rpc.mockResolvedValue({ data: { checklistId: CHECKLIST }, error: null });

    const response = await POST(postRequest(validBody), params);

    expect(response.status).toBe(500);
  });

  it("POST requires authentication after the CSRF and validation gates", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });

    const response = await POST(postRequest(validBody), params);

    expect(response.status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("GET collapses an unexpected non-problem error into a 500", async () => {
    mocks.createSupabaseServerClient.mockRejectedValueOnce(new Error("boom"));

    const response = await GET(
      new Request(`http://localhost/api/v2/organizations/${ORG}/work-orders/${WO}/checklists`),
      params,
    );

    expect(response.status).toBe(500);
  });

  it("GET rejects a malformed org id", async () => {
    const response = await GET(
      new Request(`http://localhost/api/v2/organizations/bad/work-orders/${WO}/checklists`),
      { params: Promise.resolve({ orgId: "bad", id: WO }) },
    );

    expect(response.status).toBe(422);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
