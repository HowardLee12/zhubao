import { beforeEach, describe, expect, it, vi } from "vitest";

import { quoteFixtureIds, quoteWorkspaceFixture } from "@/testing/quote-fixtures";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  createSupabaseServerClient: vi.fn(),
  authorizeOrgManager: vi.fn(),
}));
vi.mock("@/server/supabase/server", () => ({ createSupabaseServerClient: mocks.createSupabaseServerClient }));
vi.mock("@/server/api/org-authorization", () => ({ authorizeOrgManager: mocks.authorizeOrgManager }));

import { POST } from "./route";

const csrf = "csrf-token-value-0123456789-abcdefghij";

function request(headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost/api/v2/organizations/${quoteFixtureIds.organization}/quotes/${quoteFixtureIds.quote}/versions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost",
      cookie: `renoly-csrf=${csrf}`,
      "x-csrf-token": csrf,
      "if-match": '"3"',
      "idempotency-key": "quote-clone-key",
      ...headers,
    },
    body: JSON.stringify({ cloneFromVersionId: quoteFixtureIds.version }),
  });
}

function call(input = request()) {
  return POST(input, {
    params: Promise.resolve({ orgId: quoteFixtureIds.organization, id: quoteFixtureIds.quote }),
  });
}

describe("POST /api/v2/organizations/:orgId/quotes/:id/versions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createSupabaseServerClient.mockResolvedValue({ rpc: mocks.rpc });
    mocks.authorizeOrgManager.mockResolvedValue({ userId: "u1" });
    mocks.rpc.mockResolvedValue({ data: quoteWorkspaceFixture(), error: null });
  });

  it("clones the exact rejected version through an idempotent RPC", async () => {
    const response = await call();
    expect(response.status).toBe(201);
    expect(mocks.rpc).toHaveBeenCalledWith("clone_pilot_quote_version", {
      p_organization_id: quoteFixtureIds.organization,
      p_quote_id: quoteFixtureIds.quote,
      p_clone_from_version_id: quoteFixtureIds.version,
      p_expected_quote_lock_version: 3,
      p_idempotency_key: "quote-clone-key",
      p_request_id: expect.any(String),
    });
  });

  it("requires idempotency before authorization", async () => {
    const response = await call(request({ "idempotency-key": "" }));
    expect(response.status).toBe(400);
    expect(mocks.authorizeOrgManager).not.toHaveBeenCalled();
  });

  it("maps lifecycle conflicts without leaking database details", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "QUOTE_REVISION_NOT_ALLOWED" } });
    const response = await call();
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("INVALID_QUOTE_STATE");
  });
});
