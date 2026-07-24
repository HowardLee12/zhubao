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

function call() {
  return GET(
    new Request(`http://localhost/api/v2/organizations/${quoteFixtureIds.organization}/service-requests/${quoteFixtureIds.request}/quote`),
    { params: Promise.resolve({ orgId: quoteFixtureIds.organization, id: quoteFixtureIds.request }) },
  );
}

describe("GET /api/v2/organizations/:orgId/service-requests/:id/quote", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createSupabaseServerClient.mockResolvedValue({ rpc: mocks.rpc });
    mocks.authorizeOrgManager.mockResolvedValue({ userId: "u1" });
    mocks.rpc.mockResolvedValue({ data: quoteWorkspaceFixture(), error: null });
  });

  it("reopens the one quote attached to the request", async () => {
    const response = await call();
    expect(response.status).toBe(200);
    expect(response.headers.get("etag")).toBe('"1"');
    expect(mocks.rpc).toHaveBeenCalledWith("get_pilot_quote_workspace_by_request", {
      p_organization_id: quoteFixtureIds.organization,
      p_service_request_id: quoteFixtureIds.request,
    });
  });

  it("returns the same safe 404 when the request has no visible quote", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "QUOTE_NOT_FOUND" } });
    const response = await call();
    expect(response.status).toBe(404);
    expect((await response.json()).code).toBe("NOT_FOUND");
  });

  it("fails closed if the projection unexpectedly contains the wrong shape", async () => {
    mocks.rpc.mockResolvedValue({ data: {}, error: null });
    expect((await call()).status).toBe(500);
  });
});
