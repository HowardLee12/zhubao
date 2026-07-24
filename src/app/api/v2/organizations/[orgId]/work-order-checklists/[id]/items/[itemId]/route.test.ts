import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  getUser: vi.fn(),
  createSupabaseServerClient: vi.fn(),
}));

vi.mock("@/server/supabase/server", () => ({
  createSupabaseServerClient: mocks.createSupabaseServerClient,
}));

import { PATCH } from "./route";

const ORG = "20000000-0000-4000-8000-000000000001";
const CHECKLIST = "c0000000-0000-4000-8000-000000000001";
const ITEM = "c1000000-0000-4000-8000-000000000001";
const WO = "82060000-0000-4000-8000-000000000001";
const csrf = "csrf-token-value-0123456789-abcdefghij";

function patchRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(
    `http://localhost/api/v2/organizations/${ORG}/work-order-checklists/${CHECKLIST}/items/${ITEM}`,
    {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost",
        cookie: `renoly-csrf=${csrf}`,
        "x-csrf-token": csrf,
        "if-match": '"4"',
        ...headers,
      },
      body: JSON.stringify(body),
    },
  );
}

const params = { params: Promise.resolve({ orgId: ORG, id: CHECKLIST, itemId: ITEM }) };

describe("checklist item respond route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createSupabaseServerClient.mockResolvedValue({
      rpc: mocks.rpc,
      auth: { getUser: mocks.getUser },
    });
    mocks.getUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
  });

  it("records the response using the parent work-order lock version", async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        id: ITEM,
        workOrderId: WO,
        response: true,
        completedAt: "2026-08-01T02:00:00+00:00",
        lockVersion: 5,
      },
      error: null,
    });

    const response = await PATCH(patchRequest({ response: true }), params);

    expect(response.status).toBe(200);
    expect(response.headers.get("etag")).toBe('"5"');
    expect(mocks.rpc).toHaveBeenCalledWith(
      "respond_to_checklist_item",
      expect.objectContaining({
        target_org: ORG,
        target_item: ITEM,
        response_value: true,
        expected_work_order_lock_version: 4,
      }),
    );
  });

  it("rejects a null response body with a 422", async () => {
    const response = await PATCH(patchRequest({ response: null }), params);

    expect(response.status).toBe(422);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("requires If-Match", async () => {
    const response = await PATCH(patchRequest({ response: true }, { "if-match": "" }), params);

    expect(response.status).toBe(428);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("fails CSRF without a token", async () => {
    const response = await PATCH(
      patchRequest({ response: true }, { "x-csrf-token": "", cookie: "" }),
      params,
    );

    expect(response.status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("requires authentication", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });

    const response = await PATCH(patchRequest({ response: true }), params);

    expect(response.status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rejects a malformed item id", async () => {
    const response = await PATCH(patchRequest({ response: true }), {
      params: Promise.resolve({ orgId: ORG, id: CHECKLIST, itemId: "x" }),
    });

    expect(response.status).toBe(422);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("maps a wrong-response-type guard to 422", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: "CHECKLIST_RESPONSE_TYPE_INVALID" },
    });

    const response = await PATCH(patchRequest({ response: "yes" }), params);

    expect(response.status).toBe(422);
  });

  it("maps a not-editable-on-site guard to 409", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: "WORK_ORDER_NOT_EDITABLE_ON_SITE" },
    });

    const response = await PATCH(patchRequest({ response: true }), params);

    expect(response.status).toBe(409);
  });

  it("returns 500 when the responded payload fails its contract", async () => {
    mocks.rpc.mockResolvedValue({ data: { id: ITEM }, error: null });

    const response = await PATCH(patchRequest({ response: true }), params);

    expect(response.status).toBe(500);
  });

  it("collapses an unexpected non-problem error into a 500", async () => {
    mocks.createSupabaseServerClient.mockRejectedValueOnce(new Error("boom"));

    const response = await PATCH(patchRequest({ response: true }), params);

    expect(response.status).toBe(500);
  });
});
