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
const CUSTOMER = "40000000-0000-4000-8000-000000000001";
const LOCATION = "50000000-0000-4000-8000-000000000001";
const WO = "82060000-0000-4000-8000-000000000001";
const csrf = "csrf-token-value-0123456789-abcdefghij";

function detailFixture() {
  return {
    id: WO,
    organizationId: ORG,
    workOrderNo: "W-2026-0099",
    projectId: null,
    serviceRequestId: null,
    customerId: CUSTOMER,
    locationId: LOCATION,
    assetId: null,
    title: "新工單",
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
    lockVersion: 1,
    createdAt: "2026-07-19T00:00:00+00:00",
    updatedAt: "2026-07-19T00:00:00+00:00",
    assignments: [],
    checklists: [],
    photos: [{
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
    }],
  };
}

function postRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost/api/v2/organizations/${ORG}/work-orders`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost",
      cookie: `renoly-csrf=${csrf}`,
      "x-csrf-token": csrf,
      "idempotency-key": "work-order-create-key",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

describe("work-orders collection route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createSupabaseServerClient.mockResolvedValue({
      rpc: mocks.rpc,
      auth: { getUser: mocks.getUser },
    });
    mocks.getUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
  });

  it("creates a work order and strips storage paths from photos", async () => {
    mocks.rpc.mockResolvedValue({ data: detailFixture(), error: null });
    const response = await POST(
      postRequest({ customerId: CUSTOMER, locationId: LOCATION, title: "新工單" }),
      { params: Promise.resolve({ orgId: ORG }) },
    );
    expect(response.status).toBe(201);
    expect(response.headers.get("etag")).toBe('"1"');
    const body = await response.json();
    expect(body.data.photos[0].storagePath).toBe("");
    expect(mocks.rpc).toHaveBeenCalledWith("create_work_order", expect.objectContaining({
      target_org: ORG,
      p_idempotency_key: "work-order-create-key",
    }));
  });

  it("requires an idempotency key", async () => {
    const response = await POST(
      postRequest({ customerId: CUSTOMER, locationId: LOCATION, title: "x" }, {
        "idempotency-key": "",
      }),
      { params: Promise.resolve({ orgId: ORG }) },
    );
    expect(response.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("maps a FORBIDDEN rpc error to 403", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "FORBIDDEN" } });
    const response = await POST(
      postRequest({ customerId: CUSTOMER, locationId: LOCATION, title: "x" }),
      { params: Promise.resolve({ orgId: ORG }) },
    );
    expect(response.status).toBe(403);
  });

  function listItem(index: number) {
    return {
      id: `82070000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      workOrderNo: `W-2026-${index}`,
      title: "工單",
      status: "draft",
      priority: "normal",
      customerId: CUSTOMER,
      projectId: null,
      assetId: null,
      scheduledStartAt: null,
      scheduledEndAt: null,
      completedAt: null,
      lockVersion: 1,
      createdAt: `2026-07-19T00:00:${String(index % 60).padStart(2, "0")}+00:00`,
      updatedAt: "2026-07-19T00:00:00+00:00",
      assigneeCount: 0,
    };
  }

  it("lists work orders with a keyset envelope", async () => {
    mocks.rpc.mockResolvedValue({
      data: { organizationId: ORG, items: [listItem(1)] },
      error: null,
    });
    const response = await GET(
      new Request(`http://localhost/api/v2/organizations/${ORG}/work-orders?status=draft`),
      { params: Promise.resolve({ orgId: ORG }) },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toHaveLength(1);
    expect(body.meta.hasMore).toBe(false);
    expect(body.meta.nextCursor).toBeNull();
  });

  it("emits a nextCursor when a full page signals there may be more", async () => {
    const fullPage = Array.from({ length: 3 }, (_, i) => listItem(i + 1));
    mocks.rpc.mockResolvedValue({
      data: { organizationId: ORG, items: fullPage },
      error: null,
    });
    const response = await GET(
      new Request(`http://localhost/api/v2/organizations/${ORG}/work-orders?pageSize=3`),
      { params: Promise.resolve({ orgId: ORG }) },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.meta.hasMore).toBe(true);
    expect(typeof body.meta.nextCursor).toBe("string");
    expect(body.meta.nextCursor.length).toBeGreaterThan(0);
  });

  it("GET requires authentication", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    const response = await GET(
      new Request(`http://localhost/api/v2/organizations/${ORG}/work-orders`),
      { params: Promise.resolve({ orgId: ORG }) },
    );
    expect(response.status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("GET rejects an out-of-range pageSize with a 422 before the RPC", async () => {
    const response = await GET(
      new Request(`http://localhost/api/v2/organizations/${ORG}/work-orders?pageSize=9999`),
      { params: Promise.resolve({ orgId: ORG }) },
    );
    expect(response.status).toBe(422);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("GET rejects a tampered/undecodable cursor with a 400 before the RPC", async () => {
    const response = await GET(
      new Request(`http://localhost/api/v2/organizations/${ORG}/work-orders?cursor=not-base64url`),
      { params: Promise.resolve({ orgId: ORG }) },
    );
    expect(response.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("GET returns 500 when the RPC list projection fails its contract", async () => {
    mocks.rpc.mockResolvedValue({
      data: { organizationId: ORG, items: [{ id: "not-a-uuid" }] },
      error: null,
    });
    const response = await GET(
      new Request(`http://localhost/api/v2/organizations/${ORG}/work-orders`),
      { params: Promise.resolve({ orgId: ORG }) },
    );
    expect(response.status).toBe(500);
  });

  it("GET maps a FORBIDDEN rpc error to 403", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "FORBIDDEN" } });
    const response = await GET(
      new Request(`http://localhost/api/v2/organizations/${ORG}/work-orders`),
      { params: Promise.resolve({ orgId: ORG }) },
    );
    expect(response.status).toBe(403);
  });

  it("POST collapses an unexpected non-problem error into a 500", async () => {
    mocks.createSupabaseServerClient.mockRejectedValueOnce(new Error("connection reset"));
    const response = await POST(
      postRequest({ customerId: CUSTOMER, locationId: LOCATION, title: "x" }),
      { params: Promise.resolve({ orgId: ORG }) },
    );
    expect(response.status).toBe(500);
  });

  it("POST returns 200 on an idempotent replay envelope", async () => {
    mocks.rpc.mockResolvedValue({ data: { ...detailFixture(), replayed: true }, error: null });
    const response = await POST(
      postRequest({ customerId: CUSTOMER, locationId: LOCATION, title: "新工單" }),
      { params: Promise.resolve({ orgId: ORG }) },
    );
    expect(response.status).toBe(200);
  });

  it("POST rejects a malformed org id after the CSRF and idempotency gates", async () => {
    const response = await POST(
      postRequest({ customerId: CUSTOMER, locationId: LOCATION, title: "x" }),
      { params: Promise.resolve({ orgId: "bad" }) },
    );
    expect(response.status).toBe(422);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("POST requires authentication after the body is validated", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    const response = await POST(
      postRequest({ customerId: CUSTOMER, locationId: LOCATION, title: "x" }),
      { params: Promise.resolve({ orgId: ORG }) },
    );
    expect(response.status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("POST returns 500 when the created detail fails its contract", async () => {
    mocks.rpc.mockResolvedValue({ data: { id: WO }, error: null });
    const response = await POST(
      postRequest({ customerId: CUSTOMER, locationId: LOCATION, title: "x" }),
      { params: Promise.resolve({ orgId: ORG }) },
    );
    expect(response.status).toBe(500);
  });

  it("GET rejects a malformed org id before the RPC", async () => {
    const response = await GET(
      new Request(`http://localhost/api/v2/organizations/bad/work-orders`),
      { params: Promise.resolve({ orgId: "bad" }) },
    );
    expect(response.status).toBe(422);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
