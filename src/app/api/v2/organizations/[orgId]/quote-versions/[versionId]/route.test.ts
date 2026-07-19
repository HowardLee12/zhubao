import { beforeEach, describe, expect, it, vi } from "vitest";

import { quoteFixtureIds, quoteWorkspaceFixture } from "@/testing/quote-fixtures";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  createSupabaseServerClient: vi.fn(),
  authorizeOrgManager: vi.fn(),
}));
vi.mock("@/server/supabase/server", () => ({ createSupabaseServerClient: mocks.createSupabaseServerClient }));
vi.mock("@/server/api/org-authorization", () => ({ authorizeOrgManager: mocks.authorizeOrgManager }));

import { PATCH } from "./route";

const csrf = "csrf-token-value-0123456789-abcdefghij";
const workspace = quoteWorkspaceFixture();
const validBody = {
  title: workspace.version.title,
  validUntil: workspace.version.validUntil,
  customerNotes: workspace.version.customerNotes,
  internalNotes: workspace.version.internalNotes,
  terms: workspace.version.terms,
  items: workspace.version.items.map((item) => ({
    serviceCatalogItemId: item.serviceCatalogItemId,
    groupName: item.groupName,
    name: item.name,
    specification: item.specification,
    unit: item.unit,
    quantity: item.quantity,
    unitCostMinor: item.unitCostMinor,
    unitPriceMinor: item.unitPriceMinor,
    discountMinor: item.discountMinor,
    taxRate: item.taxRate,
    sortOrder: item.sortOrder,
  })),
};

function request(body: unknown = validBody): Request {
  return new Request(`http://localhost/api/v2/organizations/${quoteFixtureIds.organization}/quote-versions/${quoteFixtureIds.version}`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost",
      cookie: `renoly-csrf=${csrf}`,
      "x-csrf-token": csrf,
      "if-match": '"1"',
    },
    body: JSON.stringify(body),
  });
}

function call(input: Request = request()) {
  return PATCH(input, {
    params: Promise.resolve({ orgId: quoteFixtureIds.organization, versionId: quoteFixtureIds.version }),
  });
}

describe("PATCH /api/v2/organizations/:orgId/quote-versions/:versionId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createSupabaseServerClient.mockResolvedValue({ rpc: mocks.rpc });
    mocks.authorizeOrgManager.mockResolvedValue({ userId: "u1" });
    mocks.rpc.mockResolvedValue({ data: workspace, error: null });
  });

  it("atomically saves the complete server-calculated draft", async () => {
    const response = await call();
    expect(response.status).toBe(200);
    expect(response.headers.get("etag")).toBe('"1"');
    expect(mocks.rpc).toHaveBeenCalledWith("save_pilot_quote_draft", {
      p_organization_id: quoteFixtureIds.organization,
      p_version_id: quoteFixtureIds.version,
      p_expected_quote_lock_version: 1,
      p_payload: validBody,
      p_request_id: expect.any(String),
    });
  });

  it("rejects an excessive discount before authorization or database access", async () => {
    const body = {
      ...validBody,
      items: [{ ...validBody.items[0], unitPriceMinor: "1", discountMinor: "3" }],
    };
    const response = await call(request(body));
    expect(response.status).toBe(422);
    expect((await response.json()).code).toBe("DISCOUNT_EXCEEDS_SUBTOTAL");
    expect(mocks.authorizeOrgManager).not.toHaveBeenCalled();
  });

  it("maps a stale database write and invalid projection safely", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: "STALE_VERSION" } });
    expect((await call()).status).toBe(412);
    mocks.rpc.mockResolvedValueOnce({ data: { internal: "bad" }, error: null });
    expect((await call()).status).toBe(500);
  });
});
