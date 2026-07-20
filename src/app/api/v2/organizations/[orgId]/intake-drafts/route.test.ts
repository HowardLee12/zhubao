import { afterEach, describe, expect, it, vi } from "vitest";

const { getUser, createSupabaseServerClient, listIntakeDrafts } = vi.hoisted(() => {
  const getUser = vi.fn();
  const listIntakeDrafts = vi.fn();
  return {
    getUser,
    listIntakeDrafts,
    createSupabaseServerClient: vi.fn(async () => ({ auth: { getUser } })),
  };
});

vi.mock("@/server/supabase/server", () => ({ createSupabaseServerClient }));
vi.mock("@/server/intake/read", () => ({ listIntakeDrafts }));

import { GET } from "./route";

const orgId = "2f66bf0a-b8d9-4722-9e2a-23f218f25d86";

function draft(overrides: Record<string, unknown> = {}) {
  return {
    id: "d0000000-0000-4000-8000-000000000001",
    conversationId: "c0000000-0000-4000-8000-000000000001",
    status: "pending_review",
    origin: "ai",
    source: "line",
    title: "冷氣進件",
    summary: "冷氣不冷",
    confidence: 0.8,
    missingFields: ["address"],
    lineUserId: "Uabc",
    messageCount: 3,
    lastMessageAt: "2026-07-20T10:04:00.000Z",
    lockVersion: 2,
    createdAt: "2026-07-20T10:00:00.000Z",
    updatedAt: "2026-07-20T10:05:00.000Z",
    ...overrides,
  };
}

function makeRequest(query = ""): Request {
  return new Request(
    `https://renoly.test/api/v2/organizations/${orgId}/intake-drafts${query}`,
  );
}

function contextFor(id: string = orgId) {
  return { params: Promise.resolve({ orgId: id }) };
}

describe("GET .../intake-drafts", () => {
  afterEach(() => vi.clearAllMocks());

  it("returns 200 with the parsed inbox items (default pending_review)", async () => {
    getUser.mockResolvedValue({ data: { user: { id: crypto.randomUUID() } }, error: null });
    listIntakeDrafts.mockResolvedValue([draft()]);

    const response = await GET(makeRequest(), contextFor());

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].source).toBe("line");
    // Default status + default limit flow through to the read module.
    expect(listIntakeDrafts).toHaveBeenCalledWith(
      expect.anything(),
      orgId,
      "pending_review",
      50,
    );
  });

  it("passes an explicit status + limit through to the read module", async () => {
    getUser.mockResolvedValue({ data: { user: { id: crypto.randomUUID() } }, error: null });
    listIntakeDrafts.mockResolvedValue([]);

    const response = await GET(makeRequest("?status=confirmed&limit=10"), contextFor());

    expect(response.status).toBe(200);
    expect(listIntakeDrafts).toHaveBeenCalledWith(
      expect.anything(),
      orgId,
      "confirmed",
      10,
    );
  });

  it("returns 422 for an invalid orgId path segment", async () => {
    const response = await GET(makeRequest(), contextFor("not-a-uuid"));
    expect(response.status).toBe(422);
    expect(listIntakeDrafts).not.toHaveBeenCalled();
  });

  it("returns 422 for an out-of-enum status", async () => {
    const response = await GET(makeRequest("?status=bogus"), contextFor());
    expect(response.status).toBe(422);
    expect(listIntakeDrafts).not.toHaveBeenCalled();
  });

  it("returns 422 for a limit above the max page size", async () => {
    const response = await GET(makeRequest("?limit=500"), contextFor());
    expect(response.status).toBe(422);
    expect(listIntakeDrafts).not.toHaveBeenCalled();
  });

  it("requires a session (401) and never touches the read module", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: { message: "no session" } });

    const response = await GET(makeRequest(), contextFor());
    expect(response.status).toBe(401);
    expect(listIntakeDrafts).not.toHaveBeenCalled();
  });

  it("maps an unexpected read failure to a non-leaky 500", async () => {
    getUser.mockResolvedValue({ data: { user: { id: crypto.randomUUID() } }, error: null });
    listIntakeDrafts.mockRejectedValue(new Error("db down"));

    const response = await GET(makeRequest(), contextFor());
    expect(response.status).toBe(500);
  });
});
