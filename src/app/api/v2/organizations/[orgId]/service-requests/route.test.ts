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

import { decodeKeysetCursor } from "@/schemas/keyset-cursor";

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
    category: null,
    lockVersion: 1,
    customerId: "40000000-0000-4000-8000-000000000001",
    assignedMemberId: null,
    triagedAt: null,
    serviceCatalogItemId: "71100000-0000-4000-8000-000000000001",
    serviceName: "現場估價",
    serviceCategory: "防水工程",
    address: "台北市松山區民生東路四段 88 號",
    photoCount: 2,
    preferredWindows: [],
    createdAt: "2026-07-16T10:00:00.000Z",
    updatedAt: "2026-07-16T10:00:00.000Z",
    ...overrides,
  };
}

function envelope(items: unknown[]) {
  return { organizationId: orgId, items };
}

describe("GET /api/v2/organizations/:orgId/service-requests", () => {
  afterEach(() => vi.clearAllMocks());

  it("returns a keyset page from the RPC and a null cursor when short", async () => {
    getUser.mockResolvedValue({ data: { user: { id: crypto.randomUUID() } }, error: null });
    rpc.mockResolvedValue({ data: envelope([rpcRow()]), error: null });

    const response = await GET(
      new Request(
        `https://renoly.test/api/v2/organizations/${orgId}/service-requests?status=new&limit=50`,
      ),
      { params: Promise.resolve({ orgId }) },
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe("4c76d4c5-c978-4bdb-a918-caa82988e5fa");
    expect(body.meta).toEqual({ hasMore: false, nextCursor: null });
    expect(rpc).toHaveBeenCalledWith("list_pilot_service_requests", {
      p_organization_id: orgId,
      p_status: "new",
      p_after_created_at: null,
      p_after_id: null,
      p_limit: 50,
    });
  });

  it("emits a real opaque nextCursor when the page fills the limit", async () => {
    getUser.mockResolvedValue({ data: { user: { id: crypto.randomUUID() } }, error: null });
    rpc.mockResolvedValue({
      data: envelope([
        rpcRow({ id: "4c76d4c5-c978-4bdb-a918-caa82988e5fa" }),
        rpcRow({
          id: "5c76d4c5-c978-4bdb-a918-caa82988e5fb",
          createdAt: "2026-07-15T10:00:00.000Z",
        }),
      ]),
      error: null,
    });

    const response = await GET(
      new Request(`https://renoly.test/api/v2/organizations/${orgId}/service-requests?limit=2`),
      { params: Promise.resolve({ orgId }) },
    );

    const body = await response.json();
    expect(body.meta.hasMore).toBe(true);
    expect(typeof body.meta.nextCursor).toBe("string");
    expect(decodeKeysetCursor(body.meta.nextCursor)).toEqual({
      createdAt: "2026-07-15T10:00:00.000Z",
      id: "5c76d4c5-c978-4bdb-a918-caa82988e5fb",
    });
  });

  it("decodes a supplied cursor into the RPC keyset parameters", async () => {
    getUser.mockResolvedValue({ data: { user: { id: crypto.randomUUID() } }, error: null });
    rpc.mockResolvedValue({ data: envelope([]), error: null });

    const cursor = Buffer.from(
      JSON.stringify({
        createdAt: "2026-07-15T10:00:00.000Z",
        id: "5c76d4c5-c978-4bdb-a918-caa82988e5fb",
      }),
    )
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    const response = await GET(
      new Request(
        `https://renoly.test/api/v2/organizations/${orgId}/service-requests?limit=50&cursor=${cursor}`,
      ),
      { params: Promise.resolve({ orgId }) },
    );

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("list_pilot_service_requests", {
      p_organization_id: orgId,
      p_status: null,
      p_after_created_at: "2026-07-15T10:00:00.000Z",
      p_after_id: "5c76d4c5-c978-4bdb-a918-caa82988e5fb",
      p_limit: 50,
    });
  });

  it("rejects a malformed cursor with 400 before touching the RPC", async () => {
    getUser.mockResolvedValue({ data: { user: { id: crypto.randomUUID() } }, error: null });

    const response = await GET(
      new Request(
        `https://renoly.test/api/v2/organizations/${orgId}/service-requests?cursor=not!valid`,
      ),
      { params: Promise.resolve({ orgId }) },
    );

    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects an out-of-range limit query parameter", async () => {
    getUser.mockResolvedValue({ data: { user: { id: crypto.randomUUID() } }, error: null });

    const response = await GET(
      new Request(`https://renoly.test/api/v2/organizations/${orgId}/service-requests?limit=999`),
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

  it("maps a FORBIDDEN RPC error to 403", async () => {
    getUser.mockResolvedValue({ data: { user: { id: crypto.randomUUID() } }, error: null });
    rpc.mockResolvedValue({ data: null, error: { message: "FORBIDDEN" } });

    const response = await GET(
      new Request(`https://renoly.test/api/v2/organizations/${orgId}/service-requests`),
      { params: Promise.resolve({ orgId }) },
    );

    expect(response.status).toBe(403);
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
