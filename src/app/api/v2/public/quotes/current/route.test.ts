import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { publicQuoteFixture } from "@/testing/quote-fixtures";

const mocks = vi.hoisted(() => ({
  authorizePublicQuoteRequest: vi.fn(),
  resolvePublicQuote: vi.fn(),
}));

vi.mock("@/server/quotes/gateway", () => ({
  authorizePublicQuoteRequest: mocks.authorizePublicQuoteRequest,
  resolvePublicQuote: mocks.resolvePublicQuote,
}));

import { GET } from "./route";

const token = "x".repeat(43);
const access = { testGrant: "view" };

function request(authorization = `Bearer ${token}`): Request {
  return new Request("https://app.renoly.test/api/v2/public/quotes/current", {
    headers: {
      authorization,
      "x-forwarded-for": "203.0.113.7",
    },
  });
}

describe("GET /api/v2/public/quotes/current", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("PUBLIC_TOKEN_PEPPER", "pilot-test-pepper-that-is-longer-than-32-bytes");
    mocks.authorizePublicQuoteRequest.mockResolvedValue(access);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reads the bearer capability, applies an IP budget and returns only the public DTO", async () => {
    mocks.resolvePublicQuote.mockResolvedValue(publicQuoteFixture());
    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.authorizePublicQuoteRequest).toHaveBeenCalledWith({
      tokenHashHex: expect.stringMatching(/^[a-f0-9]{64}$/),
      clientIpHashHex: expect.stringMatching(/^[a-f0-9]{64}$/),
      action: "view",
    });
    expect(mocks.resolvePublicQuote).toHaveBeenCalledWith(access);
    expect(JSON.stringify(await response.json())).not.toMatch(
      /unitCost|internalNotes|organizationId|versionId/,
    );
  });

  it("returns an indistinguishable token-free 404 for a malformed bearer", async () => {
    const response = await GET(request("Bearer bad-token"));
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.code).toBe("PUBLIC_LINK_NOT_FOUND");
    expect(body.instance).toBe("/api/v2/public/quotes/current");
    expect(JSON.stringify(body)).not.toContain("bad-token");
    expect(mocks.authorizePublicQuoteRequest).not.toHaveBeenCalled();
    expect(mocks.resolvePublicQuote).not.toHaveBeenCalled();
  });
});
