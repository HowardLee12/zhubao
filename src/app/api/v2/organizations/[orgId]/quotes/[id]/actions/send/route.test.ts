import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { quoteFixtureIds, quoteWorkspaceFixture } from "@/testing/quote-fixtures";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  createSupabaseServerClient: vi.fn(),
  authorizeOrgManager: vi.fn(),
  createIdempotentPublicCapabilityToken: vi.fn(),
}));

vi.mock("@/server/supabase/server", () => ({
  createSupabaseServerClient: mocks.createSupabaseServerClient,
}));
vi.mock("@/server/api/org-authorization", () => ({
  authorizeOrgManager: mocks.authorizeOrgManager,
}));
vi.mock("@/server/supabase/public-token", () => ({
  createIdempotentPublicCapabilityToken: mocks.createIdempotentPublicCapabilityToken,
}));

import { POST } from "./route";

const csrf = "csrf-token-value-0123456789-abcdefghij";

function request(
  headers: Record<string, string> = {},
  url = `https://app.renoly.test/api/v2/organizations/${quoteFixtureIds.organization}/quotes/${quoteFixtureIds.quote}/actions/send`,
): Request {
  return new Request(
    url,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://app.renoly.test",
        cookie: `renoly-csrf=${csrf}`,
        "x-csrf-token": csrf,
        "if-match": '"1"',
        "idempotency-key": "quote-send-key",
        ...headers,
      },
      body: JSON.stringify({ versionId: quoteFixtureIds.version, serviceRequestLockVersion: 3 }),
    },
  );
}

describe("POST /api/v2/organizations/:orgId/quotes/:id/actions/send", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createSupabaseServerClient.mockResolvedValue({ rpc: mocks.rpc });
    mocks.authorizeOrgManager.mockResolvedValue({ userId: "owner-1" });
    mocks.createIdempotentPublicCapabilityToken.mockReturnValue({
      rawToken: "x".repeat(43),
      hashHex: "a".repeat(64),
    });
    mocks.rpc.mockResolvedValue({ data: quoteWorkspaceFixture("sent", "sent"), error: null });
  });

  it("stores only the token hash and returns the raw token once in the customer URL", async () => {
    const response = await POST(request(), {
      params: Promise.resolve({
        orgId: quoteFixtureIds.organization,
        id: quoteFixtureIds.quote,
      }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.publicQuoteUrl).toBe(`https://app.renoly.test/public/quotes#${"x".repeat(43)}`);
    expect(JSON.stringify(body)).not.toContain("a".repeat(64));
    expect(mocks.rpc).toHaveBeenCalledWith("approve_and_send_pilot_quote", {
      p_organization_id: quoteFixtureIds.organization,
      p_quote_id: quoteFixtureIds.quote,
      p_version_id: quoteFixtureIds.version,
      p_expected_quote_lock_version: 1,
      p_expected_request_lock_version: 3,
      p_public_token_hash_hex: "a".repeat(64),
      p_idempotency_key: "quote-send-key",
      p_request_id: expect.any(String),
    });
    expect(mocks.createIdempotentPublicCapabilityToken).toHaveBeenCalledWith({
      operation: "quote-send",
      organizationId: quoteFixtureIds.organization,
      resourceId: quoteFixtureIds.quote,
      idempotencyKey: "quote-send-key",
    });
  });

  it("builds the public URL from the configured application origin, not the request host", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://public.renoly.test");
    const internalUrl = `http://internal-proxy:8080/api/v2/organizations/${quoteFixtureIds.organization}/quotes/${quoteFixtureIds.quote}/actions/send`;
    const response = await POST(request({ origin: "https://public.renoly.test" }, internalUrl), {
      params: Promise.resolve({
        orgId: quoteFixtureIds.organization,
        id: quoteFixtureIds.quote,
      }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.publicQuoteUrl).toBe(
      `https://public.renoly.test/public/quotes#${"x".repeat(43)}`,
    );
  });

  it("does not mint a public token when CSRF validation fails", async () => {
    const response = await POST(request({ origin: "https://evil.example" }), {
      params: Promise.resolve({
        orgId: quoteFixtureIds.organization,
        id: quoteFixtureIds.quote,
      }),
    });

    expect(response.status).toBe(403);
    expect(mocks.createIdempotentPublicCapabilityToken).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("maps owner-role failures and malformed database projections safely", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: "QUOTE_SEND_ROLE_REQUIRED" } });
    const forbidden = await POST(request(), {
      params: Promise.resolve({
        orgId: quoteFixtureIds.organization,
        id: quoteFixtureIds.quote,
      }),
    });
    expect(forbidden.status).toBe(403);

    mocks.rpc.mockResolvedValueOnce({ data: { version: "invalid" }, error: null });
    const malformed = await POST(request(), {
      params: Promise.resolve({
        orgId: quoteFixtureIds.organization,
        id: quoteFixtureIds.quote,
      }),
    });
    expect(malformed.status).toBe(500);
  });

  it("rejects an invalid send body before minting a capability", async () => {
    const invalid = new Request(request().url, {
      method: "POST",
      headers: request().headers,
      body: JSON.stringify({ versionId: "not-a-uuid", serviceRequestLockVersion: 0 }),
    });
    const response = await POST(invalid, {
      params: Promise.resolve({
        orgId: quoteFixtureIds.organization,
        id: quoteFixtureIds.quote,
      }),
    });
    expect(response.status).toBe(422);
    expect(mocks.createIdempotentPublicCapabilityToken).not.toHaveBeenCalled();
  });
});
