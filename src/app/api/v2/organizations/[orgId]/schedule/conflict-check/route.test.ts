import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  getUser: vi.fn(),
  createSupabaseServerClient: vi.fn(),
}));

vi.mock("@/server/supabase/server", () => ({
  createSupabaseServerClient: mocks.createSupabaseServerClient,
}));

import { POST } from "./route";

const ORG = "20000000-0000-4000-8000-000000000001";
const MEMBER = "30000000-0000-4000-8000-000000000003";
const WO = "82060000-0000-4000-8000-000000000001";
const csrf = "csrf-token-value-0123456789-abcdefghij";

const validBody = {
  membershipIds: [MEMBER],
  startsAt: "2026-08-01T01:00:00+00:00",
  endsAt: "2026-08-01T03:00:00+00:00",
};

function postRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost/api/v2/organizations/${ORG}/schedule/conflict-check`, {
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

const params = { params: Promise.resolve({ orgId: ORG }) };

describe("schedule conflict-check route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createSupabaseServerClient.mockResolvedValue({
      rpc: mocks.rpc,
      auth: { getUser: mocks.getUser },
    });
    mocks.getUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
  });

  it("returns the overlapping windows for a candidate roster", async () => {
    const conflicts = [
      {
        membershipId: MEMBER,
        workOrderId: WO,
        workOrderNo: "W-2026-0001",
        startsAt: "2026-08-01T01:30:00+00:00",
        endsAt: "2026-08-01T02:30:00+00:00",
      },
    ];
    mocks.rpc.mockResolvedValue({ data: { conflicts }, error: null });

    const response = await POST(postRequest(validBody), params);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.conflicts).toEqual(conflicts);
    expect(mocks.rpc).toHaveBeenCalledWith(
      "check_schedule_conflicts",
      expect.objectContaining({
        target_org: ORG,
        p_membership_ids: [MEMBER],
        p_starts_at: validBody.startsAt,
        p_ends_at: validBody.endsAt,
        p_exclude_work_order: null,
      }),
    );
  });

  it("passes an exclude-work-order through to the RPC", async () => {
    mocks.rpc.mockResolvedValue({ data: { conflicts: [] }, error: null });

    await POST(postRequest({ ...validBody, excludeWorkOrderId: WO }), params);

    expect(mocks.rpc).toHaveBeenCalledWith(
      "check_schedule_conflicts",
      expect.objectContaining({ p_exclude_work_order: WO }),
    );
  });

  it("requires authentication", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });

    const response = await POST(postRequest(validBody), params);

    expect(response.status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("fails CSRF when the token is absent even though this is a read-only query", async () => {
    const response = await POST(postRequest(validBody, { "x-csrf-token": "", cookie: "" }), params);

    expect(response.status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rejects an empty membership list with a 422", async () => {
    const response = await POST(postRequest({ ...validBody, membershipIds: [] }), params);

    expect(response.status).toBe(422);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rejects a malformed org id", async () => {
    const response = await POST(postRequest(validBody), {
      params: Promise.resolve({ orgId: "bad" }),
    });

    expect(response.status).toBe(422);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("maps an invalid-query RPC error to 422", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: "SCHEDULE_CONFLICT_QUERY_INVALID" },
    });

    const response = await POST(postRequest(validBody), params);

    expect(response.status).toBe(422);
  });

  it("returns 500 when the RPC payload fails its contract", async () => {
    mocks.rpc.mockResolvedValue({ data: { conflicts: [{ membershipId: "x" }] }, error: null });

    const response = await POST(postRequest(validBody), params);

    expect(response.status).toBe(500);
  });

  it("collapses an unexpected non-problem error into a 500", async () => {
    mocks.createSupabaseServerClient.mockRejectedValueOnce(new Error("boom"));

    const response = await POST(postRequest(validBody), params);

    expect(response.status).toBe(500);
  });
});
