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
const NOTIF = "88100000-0000-4000-8000-000000000001";

function detail() {
  return {
    id: NOTIF,
    channel: "line",
    templateKey: "completed",
    templateVersion: 1,
    status: "failed",
    approvalStatus: "not_required",
    attemptCount: 1,
    maxAttempts: 5,
    lastErrorCode: "RATE_LIMITED",
    hasProviderMessage: false,
    relatedType: "work_order",
    relatedId: "82000000-0000-4000-8000-000000000001",
    scheduledAt: "2026-01-05T00:00:00+00:00",
    nextAttemptAt: null,
    sentAt: null,
    failedAt: "2026-01-05T00:01:00+00:00",
    cancelledAt: null,
    createdAt: "2026-01-05T00:00:00+00:00",
    attempts: [
      { attemptNo: 1, outcome: "failed", errorCode: "RATE_LIMITED", startedAt: "2026-01-05T00:00:30+00:00", finishedAt: "2026-01-05T00:00:31+00:00" },
    ],
  };
}

function request(): Request {
  return new Request(`http://localhost/api/v2/organizations/${ORG}/notifications/${NOTIF}`, {
    method: "GET",
    headers: { accept: "application/json" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
  mocks.createSupabaseServerClient.mockResolvedValue({
    auth: { getUser: mocks.getUser },
    rpc: mocks.rpc,
  });
});

describe("GET .../notifications/[id]", () => {
  it("returns the redacted detail with an append-only attempt history", async () => {
    mocks.rpc.mockResolvedValue({ data: detail(), error: null });
    const response = await GET(request(), { params: Promise.resolve({ orgId: ORG, id: NOTIF }) });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.attempts).toHaveLength(1);
    expect(body.data).not.toHaveProperty("providerMessageId");
    expect(body.data).not.toHaveProperty("payload");
  });

  it("returns 401 when unauthenticated", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    const response = await GET(request(), { params: Promise.resolve({ orgId: ORG, id: NOTIF }) });
    expect(response.status).toBe(401);
  });

  it("maps a cross-tenant NOTIFICATION_NOT_FOUND to 404", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "NOTIFICATION_NOT_FOUND" } });
    const response = await GET(request(), { params: Promise.resolve({ orgId: ORG, id: NOTIF }) });
    expect(response.status).toBe(404);
  });

  it("returns 500 when the RPC returns an unexpected shape", async () => {
    mocks.rpc.mockResolvedValue({ data: { unexpected: true }, error: null });
    const response = await GET(request(), { params: Promise.resolve({ orgId: ORG, id: NOTIF }) });
    expect(response.status).toBe(500);
  });

  it("rejects a malformed id (validation)", async () => {
    const response = await GET(request(), { params: Promise.resolve({ orgId: ORG, id: "nope" }) });
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
