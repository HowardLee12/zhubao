import { afterEach, describe, expect, it, vi } from "vitest";

const { getUser, createSupabaseServerClient, getIntakeDraftDetail } = vi.hoisted(() => {
  const getUser = vi.fn();
  const getIntakeDraftDetail = vi.fn();
  return {
    getUser,
    getIntakeDraftDetail,
    createSupabaseServerClient: vi.fn(async () => ({ auth: { getUser } })),
  };
});

vi.mock("@/server/supabase/server", () => ({ createSupabaseServerClient }));
vi.mock("@/server/intake/read", () => ({ getIntakeDraftDetail }));

import { GET } from "./route";

const orgId = "2f66bf0a-b8d9-4722-9e2a-23f218f25d86";
const id = "d0000000-0000-4000-8000-000000000001";

function detail(overrides: Record<string, unknown> = {}) {
  return {
    id,
    conversationId: "c0000000-0000-4000-8000-000000000001",
    status: "pending_review",
    origin: "ai",
    source: "line",
    title: "冷氣進件",
    summary: "冷氣不冷",
    confidence: 0.8,
    fields: { subject: { value: "冷氣", source: "ai", confidence: 0.8 } },
    missingFields: ["address"],
    lineUserId: "Uabc",
    customerLineIdentityId: null,
    convertedServiceRequestId: null,
    lockVersion: 2,
    createdAt: "2026-07-20T10:00:00.000Z",
    updatedAt: "2026-07-20T10:05:00.000Z",
    messages: [],
    ...overrides,
  };
}

function makeRequest(): Request {
  return new Request(
    `https://renoly.test/api/v2/organizations/${orgId}/intake-drafts/${id}`,
  );
}

function contextFor(rawOrg: string = orgId, rawId: string = id) {
  return { params: Promise.resolve({ orgId: rawOrg, id: rawId }) };
}

describe("GET .../intake-drafts/:id", () => {
  afterEach(() => vi.clearAllMocks());

  it("returns 200 with the parsed detail DTO", async () => {
    getUser.mockResolvedValue({ data: { user: { id: crypto.randomUUID() } }, error: null });
    getIntakeDraftDetail.mockResolvedValue(detail());

    const response = await GET(makeRequest(), contextFor());

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.id).toBe(id);
    expect(body.data.fields.subject.source).toBe("ai");
    expect(getIntakeDraftDetail).toHaveBeenCalledWith(expect.anything(), orgId, id);
  });

  it("returns 422 for an invalid orgId", async () => {
    const response = await GET(makeRequest(), contextFor("nope", id));
    expect(response.status).toBe(422);
    expect(getIntakeDraftDetail).not.toHaveBeenCalled();
  });

  it("returns 422 for an invalid draft id", async () => {
    const response = await GET(makeRequest(), contextFor(orgId, "nope"));
    expect(response.status).toBe(422);
    expect(getIntakeDraftDetail).not.toHaveBeenCalled();
  });

  it("requires a session (401)", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: { message: "no session" } });

    const response = await GET(makeRequest(), contextFor());
    expect(response.status).toBe(401);
    expect(getIntakeDraftDetail).not.toHaveBeenCalled();
  });

  it("returns a non-leaky 404 when the draft is not visible to the caller", async () => {
    getUser.mockResolvedValue({ data: { user: { id: crypto.randomUUID() } }, error: null });
    getIntakeDraftDetail.mockResolvedValue(null);

    const response = await GET(makeRequest(), contextFor());
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.code).toBe("NOT_FOUND");
  });

  it("maps an unexpected read failure to a non-leaky 500", async () => {
    getUser.mockResolvedValue({ data: { user: { id: crypto.randomUUID() } }, error: null });
    getIntakeDraftDetail.mockRejectedValue(new Error("db down"));

    const response = await GET(makeRequest(), contextFor());
    expect(response.status).toBe(500);
  });
});
