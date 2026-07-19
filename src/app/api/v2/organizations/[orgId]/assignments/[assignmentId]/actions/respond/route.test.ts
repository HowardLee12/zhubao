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
const ASSIGNMENT = "a0000000-0000-4000-8000-000000000001";
const csrf = "csrf-token-value-0123456789-abcdefghij";

function assignmentDto(status: string) {
  return {
    id: ASSIGNMENT,
    organizationId: ORG,
    workOrderId: "82060000-0000-4000-8000-000000000001",
    membershipId: "30000000-0000-4000-8000-000000000003",
    duty: "lead",
    status,
    assignedAt: "2026-08-01T00:00:00+00:00",
    acceptedAt: status === "accepted" ? "2026-08-01T00:10:00+00:00" : null,
    declinedAt: status === "declined" ? "2026-08-01T00:10:00+00:00" : null,
    checkedInAt: null,
    completedAt: null,
    cancelledAt: null,
    declineReason: status === "declined" ? "臨時有事" : null,
    lockVersion: 2,
  };
}

function request(body: unknown): Request {
  return new Request(
    `http://localhost/api/v2/organizations/${ORG}/assignments/${ASSIGNMENT}/actions/respond`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost",
        cookie: `renoly-csrf=${csrf}`,
        "x-csrf-token": csrf,
        "if-match": '"1"',
      },
      body: JSON.stringify(body),
    },
  );
}

describe("assignment respond route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createSupabaseServerClient.mockResolvedValue({
      rpc: mocks.rpc,
      auth: { getUser: mocks.getUser },
    });
    mocks.getUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
  });

  it("accepts an assignment", async () => {
    mocks.rpc.mockResolvedValue({ data: assignmentDto("accepted"), error: null });
    const response = await POST(request({ decision: "accept" }), {
      params: Promise.resolve({ orgId: ORG, assignmentId: ASSIGNMENT }),
    });
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("respond_to_assignment", expect.objectContaining({
      p_decision: "accept",
      p_reason: null,
    }));
  });

  it("requires a reason to decline", async () => {
    const response = await POST(request({ decision: "decline" }), {
      params: Promise.resolve({ orgId: ORG, assignmentId: ASSIGNMENT }),
    });
    expect(response.status).toBe(422);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("passes the decline reason through", async () => {
    mocks.rpc.mockResolvedValue({ data: assignmentDto("declined"), error: null });
    const response = await POST(request({ decision: "decline", reason: "臨時有事" }), {
      params: Promise.resolve({ orgId: ORG, assignmentId: ASSIGNMENT }),
    });
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("respond_to_assignment", expect.objectContaining({
      p_decision: "decline",
      p_reason: "臨時有事",
    }));
  });
});
