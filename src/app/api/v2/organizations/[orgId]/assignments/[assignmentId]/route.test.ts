import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  getUser: vi.fn(),
  createSupabaseServerClient: vi.fn(),
}));

vi.mock("@/server/supabase/server", () => ({
  createSupabaseServerClient: mocks.createSupabaseServerClient,
}));

import { DELETE, PATCH } from "./route";

const ORG = "20000000-0000-4000-8000-000000000001";
const ASSIGNMENT = "a0000000-0000-4000-8000-000000000001";
const csrf = "csrf-token-value-0123456789-abcdefghij";

function assignmentDto(status: string, duty = "lead") {
  return {
    id: ASSIGNMENT,
    organizationId: ORG,
    workOrderId: "82060000-0000-4000-8000-000000000001",
    membershipId: "30000000-0000-4000-8000-000000000003",
    duty,
    status,
    assignedAt: "2026-08-01T00:00:00+00:00",
    acceptedAt: null,
    declinedAt: null,
    checkedInAt: null,
    completedAt: null,
    cancelledAt: status === "cancelled" ? "2026-08-01T01:00:00+00:00" : null,
    declineReason: null,
    lockVersion: 3,
  };
}

function mutate(
  method: "PATCH" | "DELETE",
  body: unknown,
  headers: Record<string, string> = {},
): Request {
  return new Request(`http://localhost/api/v2/organizations/${ORG}/assignments/${ASSIGNMENT}`, {
    method,
    headers: {
      "content-type": "application/json",
      origin: "http://localhost",
      cookie: `renoly-csrf=${csrf}`,
      "x-csrf-token": csrf,
      "if-match": '"2"',
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

const params = { params: Promise.resolve({ orgId: ORG, assignmentId: ASSIGNMENT }) };

describe("assignment detail route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createSupabaseServerClient.mockResolvedValue({
      rpc: mocks.rpc,
      auth: { getUser: mocks.getUser },
    });
    mocks.getUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
  });

  it("PATCH changes the duty and returns the new ETag", async () => {
    mocks.rpc.mockResolvedValue({ data: assignmentDto("assigned", "technician"), error: null });

    const response = await PATCH(mutate("PATCH", { duty: "technician" }), params);

    expect(response.status).toBe(200);
    expect(response.headers.get("etag")).toBe('"3"');
    expect(mocks.rpc).toHaveBeenCalledWith(
      "update_assignment",
      expect.objectContaining({
        target_org: ORG,
        target_assignment: ASSIGNMENT,
        p_duty: "technician",
        p_expected_lock_version: 2,
      }),
    );
  });

  it("PATCH requires If-Match", async () => {
    const response = await PATCH(mutate("PATCH", { duty: "helper" }, { "if-match": "" }), params);

    expect(response.status).toBe(428);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("PATCH fails CSRF without a token", async () => {
    const response = await PATCH(
      mutate("PATCH", { duty: "helper" }, { "x-csrf-token": "", cookie: "" }),
      params,
    );

    expect(response.status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("PATCH rejects an invalid duty with a 422", async () => {
    const response = await PATCH(mutate("PATCH", { duty: "boss" }), params);

    expect(response.status).toBe(422);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("PATCH requires authentication", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });

    const response = await PATCH(mutate("PATCH", { duty: "helper" }), params);

    expect(response.status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("PATCH maps a stale-version RPC error to 412", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "STALE_VERSION" } });

    const response = await PATCH(mutate("PATCH", { duty: "helper" }), params);

    expect(response.status).toBe(412);
  });

  it("DELETE soft-cancels with a reason", async () => {
    mocks.rpc.mockResolvedValue({ data: assignmentDto("cancelled"), error: null });

    const response = await DELETE(mutate("DELETE", { reason: "客戶臨時取消" }), params);

    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith(
      "cancel_assignment",
      expect.objectContaining({
        target_org: ORG,
        target_assignment: ASSIGNMENT,
        p_reason: "客戶臨時取消",
        p_expected_lock_version: 2,
      }),
    );
  });

  it("DELETE requires a cancellation reason", async () => {
    const response = await DELETE(mutate("DELETE", { reason: "" }), params);

    expect(response.status).toBe(422);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("DELETE rejects a malformed assignment id", async () => {
    const response = await DELETE(mutate("DELETE", { reason: "x" }), {
      params: Promise.resolve({ orgId: ORG, assignmentId: "not-a-uuid" }),
    });

    expect(response.status).toBe(422);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("DELETE maps a cancel-requires-manager RPC error to 409", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: "ASSIGNMENT_CANCEL_REQUIRES_MANAGER" },
    });

    const response = await DELETE(mutate("DELETE", { reason: "x" }), params);

    expect(response.status).toBe(409);
  });

  it("PATCH returns 500 when the updated assignment fails its contract", async () => {
    mocks.rpc.mockResolvedValue({ data: { id: ASSIGNMENT }, error: null });

    const response = await PATCH(mutate("PATCH", { duty: "helper" }), params);

    expect(response.status).toBe(500);
  });

  it("DELETE requires authentication", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });

    const response = await DELETE(mutate("DELETE", { reason: "x" }), params);

    expect(response.status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("DELETE fails CSRF without a token", async () => {
    const response = await DELETE(
      mutate("DELETE", { reason: "x" }, { "x-csrf-token": "", cookie: "" }),
      params,
    );

    expect(response.status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("PATCH collapses an unexpected non-problem error into a 500", async () => {
    mocks.createSupabaseServerClient.mockRejectedValueOnce(new Error("boom"));

    const response = await PATCH(mutate("PATCH", { duty: "helper" }), params);

    expect(response.status).toBe(500);
  });
});
