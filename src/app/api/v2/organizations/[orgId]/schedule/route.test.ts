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
const CUSTOMER = "40000000-0000-4000-8000-000000000001";
const FROM = "2026-09-01T00:00:00+00:00";
const TO = "2026-09-15T00:00:00+00:00";

// Deterministic item factory so keyset cursors advance in a real (createdAt,id) order.
function scheduleItem(index: number) {
  const id = `82050000-0000-4000-8000-${String(index).padStart(12, "0")}`;
  // Descending createdAt so later pages carry strictly-smaller cursor tuples.
  const minute = String(index % 60).padStart(2, "0");
  const hour = String(23 - (index % 24)).padStart(2, "0");
  return {
    id,
    workOrderNo: `W-${index}`,
    title: `工單 ${index}`,
    status: "scheduled",
    priority: "normal",
    customerId: CUSTOMER,
    projectId: null,
    assetId: null,
    scheduledStartAt: "2026-09-02T01:00:00+00:00",
    scheduledEndAt: "2026-09-02T03:00:00+00:00",
    completedAt: null,
    lockVersion: 1,
    createdAt: `2026-08-01T${hour}:${minute}:00+00:00`,
    updatedAt: `2026-08-01T${hour}:${minute}:00+00:00`,
    assigneeCount: 0,
  };
}

function scheduleRequest(from = FROM, to = TO): Request {
  const url = new URL(`http://localhost/api/v2/organizations/${ORG}/schedule`);
  url.searchParams.set("from", from);
  url.searchParams.set("to", to);
  return new Request(url);
}

describe("schedule board route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createSupabaseServerClient.mockResolvedValue({
      rpc: mocks.rpc,
      auth: { getUser: mocks.getUser },
    });
    mocks.getUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
  });

  it("returns the window in a single page with hasMore false when under one page", async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        organizationId: ORG,
        items: [scheduleItem(1), scheduleItem(2)],
      },
      error: null,
    });

    const response = await GET(scheduleRequest(), {
      params: Promise.resolve({ orgId: ORG }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toHaveLength(2);
    expect(body.meta.hasMore).toBe(false);
    // A short window never needs a second keyset page.
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith("list_work_orders", expect.objectContaining({
      target_org: ORG,
      p_cursor_created_at: null,
      p_cursor_id: null,
      p_page_size: 100,
    }));
  });

  it("loops the keyset cursor to cover a window larger than one page", async () => {
    const firstPage = Array.from({ length: 100 }, (_, i) => scheduleItem(i + 1));
    const secondPage = [scheduleItem(101), scheduleItem(102)];

    mocks.rpc
      .mockResolvedValueOnce({ data: { organizationId: ORG, items: firstPage }, error: null })
      .mockResolvedValueOnce({ data: { organizationId: ORG, items: secondPage }, error: null });

    const response = await GET(scheduleRequest(), {
      params: Promise.resolve({ orgId: ORG }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    // Every scheduled work order in the window is present — nothing is truncated.
    expect(body.data).toHaveLength(102);
    expect(body.meta.hasMore).toBe(false);
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
    // The second call must carry the last item's keyset tuple.
    const lastOfFirst = firstPage[firstPage.length - 1];
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, "list_work_orders", expect.objectContaining({
      p_cursor_created_at: lastOfFirst.createdAt,
      p_cursor_id: lastOfFirst.id,
      p_page_size: 100,
    }));
  });

  it("signals hasMore when the safety page cap is hit so a dispatcher is never silently blind", async () => {
    // Always return a full page so the loop can never naturally terminate.
    mocks.rpc.mockImplementation((_fn, args) => {
      const base = args.p_cursor_id ? 50 : 0;
      const items = Array.from({ length: 100 }, (_, i) => scheduleItem(base + i + 1));
      return Promise.resolve({ data: { organizationId: ORG, items }, error: null });
    });

    const response = await GET(scheduleRequest(), {
      params: Promise.resolve({ orgId: ORG }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.meta.hasMore).toBe(true);
    // The loop is bounded — it must not spin forever.
    expect(mocks.rpc.mock.calls.length).toBeGreaterThan(1);
    expect(mocks.rpc.mock.calls.length).toBeLessThanOrEqual(50);
  });

  it("requires authentication", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });

    const response = await GET(scheduleRequest(), {
      params: Promise.resolve({ orgId: ORG }),
    });

    expect(response.status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rejects a window wider than 31 days before touching the RPC", async () => {
    const response = await GET(
      scheduleRequest("2026-09-01T00:00:00+00:00", "2026-10-15T00:00:00+00:00"),
      { params: Promise.resolve({ orgId: ORG }) },
    );

    // Zod validation failures surface as RFC-9457 422 in this codebase.
    expect(response.status).toBe(422);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("maps a FORBIDDEN rpc error to 403", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "FORBIDDEN" } });

    const response = await GET(scheduleRequest(), {
      params: Promise.resolve({ orgId: ORG }),
    });

    expect(response.status).toBe(403);
  });
});
