import { afterEach, describe, expect, it, vi } from "vitest";

const { getUser, rpc, createSupabaseServerClient } = vi.hoisted(() => {
  const getUser = vi.fn();
  const rpc = vi.fn();
  return {
    getUser,
    rpc,
    createSupabaseServerClient: vi.fn(async () => ({ auth: { getUser }, rpc })),
  };
});

vi.mock("@/server/supabase/server", () => ({ createSupabaseServerClient }));

import { GET } from "./route";

const orgId = "2f66bf0a-b8d9-4722-9e2a-23f218f25d86";

function rpcRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "4c76d4c5-c978-4bdb-a918-caa82988e5fa",
    requestNo: "SR-2026-00001",
    contactName: "王先生",
    contactPhone: "+886912345678",
    subject: "浴室牆面滲水",
    description: "下雨後有水痕",
    status: "new",
    priority: "normal",
    serviceCatalogItemId: "71100000-0000-4000-8000-000000000001",
    serviceName: "現場估價",
    category: "防水工程",
    address: "台北市松山區民生東路四段 88 號",
    photoCount: 2,
    preferredWindows: [],
    createdAt: "2026-07-16T10:00:00.000Z",
    updatedAt: "2026-07-16T10:00:00.000Z",
    ...overrides,
  };
}

const mappedItem = {
  id: "4c76d4c5-c978-4bdb-a918-caa82988e5fa",
  referenceNo: "SR-2026-00001",
  source: "web",
  contactName: "王先生",
  contactPhone: "+886912345678",
  serviceName: "現場估價",
  category: "防水工程",
  title: "浴室牆面滲水",
  description: "下雨後有水痕",
  address: "台北市松山區民生東路四段 88 號",
  photoCount: 2,
  status: "new",
  priority: "normal",
  createdAt: "2026-07-16T10:00:00.000Z",
};

function envelope(items: unknown[]) {
  return { organizationId: orgId, items };
}

describe("GET /api/v2/organizations/:orgId/service-requests", () => {
  afterEach(() => vi.clearAllMocks());

  it("returns a strict DB-backed, UI-mapped inbox for the authenticated member", async () => {
    getUser.mockResolvedValue({ data: { user: { id: crypto.randomUUID() } }, error: null });
    rpc.mockResolvedValue({ data: envelope([rpcRow()]), error: null });

    const response = await GET(
      new Request(
        `https://renoly.test/api/v2/organizations/${orgId}/service-requests?status=new&limit=50`,
      ),
      { params: Promise.resolve({ orgId }) },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: [mappedItem],
      meta: { hasMore: false, nextCursor: null },
    });
    expect(rpc).toHaveBeenCalledWith("list_pilot_service_requests", {
      p_organization_id: orgId,
      p_page_size: 100,
    });
  });

  it("filters by status and derives hasMore honestly from the filtered page", async () => {
    getUser.mockResolvedValue({ data: { user: { id: crypto.randomUUID() } }, error: null });
    rpc.mockResolvedValue({
      data: envelope([
        rpcRow({ id: "4c76d4c5-c978-4bdb-a918-caa82988e5fa", status: "new" }),
        rpcRow({ id: "5c76d4c5-c978-4bdb-a918-caa82988e5fb", status: "quoted" }),
        rpcRow({ id: "6c76d4c5-c978-4bdb-a918-caa82988e5fc", status: "new" }),
      ]),
      error: null,
    });

    const response = await GET(
      new Request(
        `https://renoly.test/api/v2/organizations/${orgId}/service-requests?status=new&limit=1`,
      ),
      { params: Promise.resolve({ orgId }) },
    );

    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(body.data.every((item: { status: string }) => item.status === "new")).toBe(true);
    expect(body.meta.hasMore).toBe(true);
  });

  it("rejects an out-of-range limit query parameter", async () => {
    getUser.mockResolvedValue({ data: { user: { id: crypto.randomUUID() } }, error: null });

    const response = await GET(
      new Request(
        `https://renoly.test/api/v2/organizations/${orgId}/service-requests?limit=999`,
      ),
      { params: Promise.resolve({ orgId }) },
    );

    expect(response.status).toBe(422);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("requires a real Supabase user session", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: { message: "invalid" } });

    const response = await GET(
      new Request(`https://renoly.test/api/v2/organizations/${orgId}/service-requests`),
      { params: Promise.resolve({ orgId }) },
    );

    expect(response.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("does not expose malformed or extra RPC fields", async () => {
    getUser.mockResolvedValue({ data: { user: { id: crypto.randomUUID() } }, error: null });
    rpc.mockResolvedValue({
      data: envelope([{ ...rpcRow(), storagePath: "private/photo.jpg" }]),
      error: null,
    });

    const response = await GET(
      new Request(`https://renoly.test/api/v2/organizations/${orgId}/service-requests`),
      { params: Promise.resolve({ orgId }) },
    );

    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("storagePath");
  });
});
