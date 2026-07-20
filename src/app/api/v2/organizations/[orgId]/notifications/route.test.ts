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

function redactedRow() {
  return {
    id: "88100000-0000-4000-8000-000000000001",
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
    nextAttemptAt: "2026-01-05T00:05:00+00:00",
    sentAt: null,
    failedAt: "2026-01-05T00:01:00+00:00",
    cancelledAt: null,
    createdAt: "2026-01-05T00:00:00+00:00",
  };
}

function request(): Request {
  return new Request(`http://localhost/api/v2/organizations/${ORG}/notifications?status=failed`, {
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

describe("GET /api/v2/organizations/[orgId]/notifications", () => {
  it("returns the redacted list and never leaks payload or provider id", async () => {
    mocks.rpc.mockResolvedValue({
      data: { organizationId: ORG, items: [redactedRow()] },
      error: null,
    });
    const response = await GET(request(), { params: Promise.resolve({ orgId: ORG }) });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toHaveLength(1);
    // The redacted view exposes a boolean, never the raw provider id or payload.
    expect(body.data[0]).not.toHaveProperty("providerMessageId");
    expect(body.data[0]).not.toHaveProperty("payload");
    expect(body.data[0].hasProviderMessage).toBe(false);
    expect(mocks.rpc).toHaveBeenCalledWith(
      "list_notifications",
      expect.objectContaining({ target_org: ORG, p_status: "failed" }),
    );
  });

  it("returns 401 when unauthenticated", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    const response = await GET(request(), { params: Promise.resolve({ orgId: ORG }) });
    expect(response.status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("maps a FORBIDDEN RPC error to 403", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "FORBIDDEN" } });
    const response = await GET(request(), { params: Promise.resolve({ orgId: ORG }) });
    expect(response.status).toBe(403);
  });

  it("rejects a malformed org id (validation error)", async () => {
    const response = await GET(request(), { params: Promise.resolve({ orgId: "nope" }) });
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
