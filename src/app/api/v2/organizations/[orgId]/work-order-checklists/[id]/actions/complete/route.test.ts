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
const CHECKLIST = "c0000000-0000-4000-8000-000000000001";
const WO = "82060000-0000-4000-8000-000000000001";
const csrf = "csrf-token-value-0123456789-abcdefghij";

function completeRequest(headers: Record<string, string> = {}): Request {
  return new Request(
    `http://localhost/api/v2/organizations/${ORG}/work-order-checklists/${CHECKLIST}/actions/complete`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost",
        cookie: `renoly-csrf=${csrf}`,
        "x-csrf-token": csrf,
        "if-match": '"4"',
        ...headers,
      },
    },
  );
}

const params = { params: Promise.resolve({ orgId: ORG, id: CHECKLIST }) };

describe("checklist complete action route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createSupabaseServerClient.mockResolvedValue({
      rpc: mocks.rpc,
      auth: { getUser: mocks.getUser },
    });
    mocks.getUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
  });

  it("completes the checklist using the parent work-order lock version", async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        checklistId: CHECKLIST,
        workOrderId: WO,
        status: "completed",
        completedAt: "2026-08-01T02:00:00+00:00",
      },
      error: null,
    });

    const response = await POST(completeRequest(), params);

    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith(
      "complete_work_order_checklist",
      expect.objectContaining({
        target_org: ORG,
        target_checklist: CHECKLIST,
        p_expected_work_order_lock_version: 4,
      }),
    );
  });

  it("requires If-Match", async () => {
    const response = await POST(completeRequest({ "if-match": "" }), params);

    expect(response.status).toBe(428);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("fails CSRF without a token", async () => {
    const response = await POST(completeRequest({ "x-csrf-token": "", cookie: "" }), params);

    expect(response.status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("requires authentication", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });

    const response = await POST(completeRequest(), params);

    expect(response.status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rejects a malformed checklist id", async () => {
    const response = await POST(completeRequest(), {
      params: Promise.resolve({ orgId: ORG, id: "x" }),
    });

    expect(response.status).toBe(422);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("maps an incomplete-required-item guard to 422", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: "REQUIRED_CHECKLIST_INCOMPLETE" },
    });

    const response = await POST(completeRequest(), params);

    expect(response.status).toBe(422);
  });

  it("maps an already-completed checklist to 409", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: "CHECKLIST_ALREADY_COMPLETED" },
    });

    const response = await POST(completeRequest(), params);

    expect(response.status).toBe(409);
  });

  it("returns 500 when the completion payload fails its contract", async () => {
    mocks.rpc.mockResolvedValue({ data: { checklistId: CHECKLIST }, error: null });

    const response = await POST(completeRequest(), params);

    expect(response.status).toBe(500);
  });

  it("collapses an unexpected non-problem error into a 500", async () => {
    mocks.createSupabaseServerClient.mockRejectedValueOnce(new Error("boom"));

    const response = await POST(completeRequest(), params);

    expect(response.status).toBe(500);
  });
});
