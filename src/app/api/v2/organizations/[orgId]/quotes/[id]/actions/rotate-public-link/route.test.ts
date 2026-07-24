import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { quoteFixtureIds, quoteWorkspaceFixture } from "@/testing/quote-fixtures";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  createSupabaseServerClient: vi.fn(),
  authorizeOrgManager: vi.fn(),
  createIdempotentPublicCapabilityToken: vi.fn(),
}));
vi.mock("@/server/supabase/server", () => ({ createSupabaseServerClient: mocks.createSupabaseServerClient }));
vi.mock("@/server/api/org-authorization", () => ({ authorizeOrgManager: mocks.authorizeOrgManager }));
vi.mock("@/server/supabase/public-token", () => ({
  createIdempotentPublicCapabilityToken: mocks.createIdempotentPublicCapabilityToken,
}));

import { POST } from "./route";

const csrf = "csrf-token-value-0123456789-abcdefghij";

function request(
  headers: Record<string, string> = {},
  url = `https://app.renoly.test/api/v2/organizations/${quoteFixtureIds.organization}/quotes/${quoteFixtureIds.quote}/actions/rotate-public-link`,
): Request {
  return new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://app.renoly.test",
      cookie: `renoly-csrf=${csrf}`,
      "x-csrf-token": csrf,
      "if-match": '"2"',
      "idempotency-key": "quote-rotate-key",
      ...headers,
    },
    body: "{}",
  });
}

function call(input = request()) {
  return POST(input, {
    params: Promise.resolve({ orgId: quoteFixtureIds.organization, id: quoteFixtureIds.quote }),
  });
}

describe("POST /api/v2/organizations/:orgId/quotes/:id/actions/rotate-public-link", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createSupabaseServerClient.mockResolvedValue({ rpc: mocks.rpc });
    mocks.authorizeOrgManager.mockResolvedValue({ userId: "owner" });
    mocks.createIdempotentPublicCapabilityToken.mockReturnValue({
      rawToken: "r".repeat(43),
      hashHex: "c".repeat(64),
    });
    mocks.rpc.mockResolvedValue({ data: quoteWorkspaceFixture("sent", "sent"), error: null });
  });

  it("rotates using only the hash and returns the new raw URL once", async () => {
    const response = await call();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.publicQuoteUrl).toBe(`https://app.renoly.test/public/quotes#${"r".repeat(43)}`);
    expect(JSON.stringify(body)).not.toContain("c".repeat(64));
    expect(mocks.rpc).toHaveBeenCalledWith("rotate_pilot_quote_public_token", {
      p_organization_id: quoteFixtureIds.organization,
      p_quote_id: quoteFixtureIds.quote,
      p_expected_quote_lock_version: 2,
      p_public_token_hash_hex: "c".repeat(64),
      p_idempotency_key: "quote-rotate-key",
      p_request_id: expect.any(String),
    });
    expect(mocks.createIdempotentPublicCapabilityToken).toHaveBeenCalledWith({
      operation: "quote-rotate",
      organizationId: quoteFixtureIds.organization,
      resourceId: quoteFixtureIds.quote,
      idempotencyKey: "quote-rotate-key",
    });
  });

  it("uses the configured public origin when the app runs behind a proxy", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://public.renoly.test");
    const internalUrl = `http://internal-proxy:8080/api/v2/organizations/${quoteFixtureIds.organization}/quotes/${quoteFixtureIds.quote}/actions/rotate-public-link`;
    const response = await call(request({ origin: "https://public.renoly.test" }, internalUrl));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.publicQuoteUrl).toBe(
      `https://public.renoly.test/public/quotes#${"r".repeat(43)}`,
    );
  });

  it("does not mint a link before CSRF and ETag validation", async () => {
    expect((await call(request({ origin: "https://evil.example" }))).status).toBe(403);
    expect(mocks.createIdempotentPublicCapabilityToken).not.toHaveBeenCalled();
    expect((await call(request({ "if-match": "" }))).status).toBe(428);
    expect(mocks.createIdempotentPublicCapabilityToken).not.toHaveBeenCalled();
  });

  it("maps stale rotation and malformed RPC projections safely", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: "STALE_VERSION" } });
    expect((await call()).status).toBe(412);
    mocks.rpc.mockResolvedValueOnce({ data: { quote: "invalid" }, error: null });
    expect((await call()).status).toBe(500);
  });
});
