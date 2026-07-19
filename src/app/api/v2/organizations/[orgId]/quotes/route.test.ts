import { beforeEach, describe, expect, it, vi } from "vitest";

import { quoteFixtureIds, quoteWorkspaceFixture } from "@/testing/quote-fixtures";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  createSupabaseServerClient: vi.fn(),
  authorizeOrgManager: vi.fn(),
}));

vi.mock("@/server/supabase/server", () => ({
  createSupabaseServerClient: mocks.createSupabaseServerClient,
}));
vi.mock("@/server/api/org-authorization", () => ({
  authorizeOrgManager: mocks.authorizeOrgManager,
}));

import { POST } from "./route";

const csrf = "csrf-token-value-0123456789-abcdefghij";
const validInput = {
  serviceRequestId: quoteFixtureIds.request,
  customerId: quoteFixtureIds.customer,
  locationId: quoteFixtureIds.location,
  currency: "TWD",
  version: {
    title: "兩台冷氣清洗報價",
    validUntil: "2026-08-02",
    customerNotes: "追加項目會先確認。",
    internalNotes: "成本不可外流",
    terms: "完工後付款。",
    items: [
      {
        serviceCatalogItemId: null,
        groupName: "服務項目",
        name: "分離式冷氣清洗",
        specification: "兩台",
        unit: "台",
        quantity: "2.000",
        unitCostMinor: "1200",
        unitPriceMinor: "2500",
        discountMinor: "0",
        taxRate: "0.0000",
        sortOrder: 10,
      },
    ],
  },
};

function request(input: unknown = validInput, headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost/api/v2/organizations/${quoteFixtureIds.organization}/quotes`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost",
      cookie: `renoly-csrf=${csrf}`,
      "x-csrf-token": csrf,
      "if-match": '"2"',
      "idempotency-key": "quote-create-key",
      ...headers,
    },
    body: JSON.stringify(input),
  });
}

describe("POST /api/v2/organizations/:orgId/quotes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createSupabaseServerClient.mockResolvedValue({ rpc: mocks.rpc });
    mocks.authorizeOrgManager.mockResolvedValue({ userId: "user-1" });
    mocks.rpc.mockResolvedValue({ data: quoteWorkspaceFixture(), error: null });
  });

  it("validates, recalculates, and creates the quote through the authenticated RPC", async () => {
    const response = await POST(request(), {
      params: Promise.resolve({ orgId: quoteFixtureIds.organization }),
    });

    expect(response.status).toBe(201);
    expect(response.headers.get("etag")).toBe('"1"');
    expect(response.headers.get("location")).toBe(
      `/api/v2/organizations/${quoteFixtureIds.organization}/quotes/${quoteFixtureIds.quote}`,
    );
    expect(mocks.authorizeOrgManager).toHaveBeenCalledWith(
      expect.objectContaining({ rpc: mocks.rpc }),
      quoteFixtureIds.organization,
    );
    expect(mocks.rpc).toHaveBeenCalledWith("create_pilot_quote", {
      p_organization_id: quoteFixtureIds.organization,
      p_service_request_id: quoteFixtureIds.request,
      p_expected_request_lock_version: 2,
      p_payload: {
        customerId: quoteFixtureIds.customer,
        locationId: quoteFixtureIds.location,
        currency: "TWD",
        ...validInput.version,
      },
      p_idempotency_key: "quote-create-key",
      p_request_id: expect.any(String),
    });
  });

  it("requires a strong request ETag before authorization", async () => {
    const response = await POST(request(validInput, { "if-match": "" }), {
      params: Promise.resolve({ orgId: quoteFixtureIds.organization }),
    });

    expect(response.status).toBe(428);
    expect((await response.json()).code).toBe("IF_MATCH_REQUIRED");
    expect(mocks.authorizeOrgManager).not.toHaveBeenCalled();
  });

  it("rejects client-supplied totals and unknown lifecycle fields", async () => {
    const response = await POST(
      request({
        ...validInput,
        version: { ...validInput.version, totalMinor: "1", status: "sent" },
      }),
      { params: Promise.resolve({ orgId: quoteFixtureIds.organization }) },
    );

    expect(response.status).toBe(422);
    expect((await response.json()).code).toBe("VALIDATION_FAILED");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("maps stale writes and rejects malformed database projections", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: "STALE_VERSION" } });
    const stale = await POST(request(), {
      params: Promise.resolve({ orgId: quoteFixtureIds.organization }),
    });
    expect(stale.status).toBe(412);

    mocks.rpc.mockResolvedValueOnce({ data: { quote: "invalid" }, error: null });
    const malformed = await POST(request(), {
      params: Promise.resolve({ orgId: quoteFixtureIds.organization }),
    });
    expect(malformed.status).toBe(500);
  });

  it("rejects malformed organization ids and impossible totals before authorization", async () => {
    const badId = await POST(request(), { params: Promise.resolve({ orgId: "bad-id" }) });
    expect(badId.status).toBe(422);
    expect(mocks.authorizeOrgManager).not.toHaveBeenCalled();

    const excessiveDiscount = {
      ...validInput,
      version: {
        ...validInput.version,
        items: [
          { ...validInput.version.items[0], unitPriceMinor: "1", discountMinor: "3" },
        ],
      },
    };
    const invalidMoney = await POST(request(excessiveDiscount), {
      params: Promise.resolve({ orgId: quoteFixtureIds.organization }),
    });
    expect(invalidMoney.status).toBe(422);
    expect((await invalidMoney.json()).code).toBe("DISCOUNT_EXCEEDS_SUBTOTAL");
  });

  it("sanitizes an unexpected infrastructure exception", async () => {
    mocks.createSupabaseServerClient.mockRejectedValue(new Error("secret connection detail"));
    const response = await POST(request(), {
      params: Promise.resolve({ orgId: quoteFixtureIds.organization }),
    });
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("secret connection detail");
  });
});
