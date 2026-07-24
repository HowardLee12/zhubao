import { beforeEach, describe, expect, it, vi } from "vitest";

import { quoteFixtureIds, quoteWorkspaceFixture } from "@/testing/quote-fixtures";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  createSupabaseServerClient: vi.fn(),
  authorizeOrgManager: vi.fn(),
}));
vi.mock("@/server/supabase/server", () => ({ createSupabaseServerClient: mocks.createSupabaseServerClient }));
vi.mock("@/server/api/org-authorization", () => ({ authorizeOrgManager: mocks.authorizeOrgManager }));

import { GET } from "./route";

function call(
  params: { orgId: string; id: string } = {
    orgId: quoteFixtureIds.organization,
    id: quoteFixtureIds.quote,
  },
) {
  return GET(new Request(`http://localhost/api/v2/organizations/${params.orgId}/quotes/${params.id}`), {
    params: Promise.resolve(params),
  });
}

describe("GET /api/v2/organizations/:orgId/quotes/:id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createSupabaseServerClient.mockResolvedValue({ rpc: mocks.rpc });
    mocks.authorizeOrgManager.mockResolvedValue({ userId: "u1" });
    mocks.rpc.mockResolvedValue({ data: quoteWorkspaceFixture(), error: null });
  });

  it("returns the authenticated staff workspace and ETag", async () => {
    const response = await call();
    expect(response.status).toBe(200);
    expect(response.headers.get("etag")).toBe('"1"');
    expect((await response.json()).data.quote.id).toBe(quoteFixtureIds.quote);
    expect(mocks.rpc).toHaveBeenCalledWith("get_pilot_quote_workspace", {
      p_organization_id: quoteFixtureIds.organization,
      p_quote_id: quoteFixtureIds.quote,
    });
  });

  it("rejects malformed path ids before creating a Supabase client", async () => {
    const response = await call({ orgId: "bad", id: quoteFixtureIds.quote });
    expect(response.status).toBe(422);
    expect(mocks.createSupabaseServerClient).not.toHaveBeenCalled();
  });

  it("maps missing quotes and fails closed on a malformed projection", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: "QUOTE_NOT_FOUND" } });
    expect((await call()).status).toBe(404);
    mocks.rpc.mockResolvedValueOnce({ data: { quote: { id: "secret" } }, error: null });
    expect((await call()).status).toBe(500);
  });
});
