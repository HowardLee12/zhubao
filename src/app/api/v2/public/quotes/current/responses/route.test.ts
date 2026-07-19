import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiProblem } from "@/server/api/problem";

const mocks = vi.hoisted(() => ({
  authorizePublicQuoteRequest: vi.fn(),
  respondToPublicQuote: vi.fn(),
}));

vi.mock("@/server/quotes/gateway", () => ({
  authorizePublicQuoteRequest: mocks.authorizePublicQuoteRequest,
  respondToPublicQuote: mocks.respondToPublicQuote,
}));

import { POST } from "./route";

const token = "x".repeat(43);
const access = { testGrant: "respond" };
const validBody = {
  decision: "accept",
  displayName: "林太太",
  comment: "請週六上午來",
};

function request(body: unknown = validBody, headers: Record<string, string> = {}): Request {
  return new Request("https://app.renoly.test/api/v2/public/quotes/current/responses", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "idempotency-key": "quote-decision-key",
      "x-forwarded-for": "203.0.113.7",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function rawRequest(body: string): Request {
  return new Request("https://app.renoly.test/api/v2/public/quotes/current/responses", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "idempotency-key": "quote-decision-key",
      "x-forwarded-for": "203.0.113.7",
    },
    body,
  });
}

describe("POST /api/v2/public/quotes/current/responses", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("PUBLIC_TOKEN_PEPPER", "pilot-test-pepper-that-is-longer-than-32-bytes");
    mocks.authorizePublicQuoteRequest.mockResolvedValue(access);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("records a rate-limited no-registration decision without a client-selected UUID", async () => {
    mocks.respondToPublicQuote.mockResolvedValue({
      decision: "accept",
      recordedAt: "2026-07-19T07:00:00.000Z",
      displayName: "林太太",
      comment: "請週六上午來",
      replayed: false,
    });
    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(mocks.authorizePublicQuoteRequest).toHaveBeenCalledWith({
      tokenHashHex: expect.stringMatching(/^[a-f0-9]{64}$/),
      clientIpHashHex: expect.stringMatching(/^[a-f0-9]{64}$/),
      action: "respond",
    });
    expect(mocks.respondToPublicQuote).toHaveBeenCalledWith({
      access,
      idempotencyKey: "quote-decision-key",
      payload: validBody,
      requestId: expect.any(String),
    });
  });

  it("consumes the public budget before rejecting a missing idempotency key", async () => {
    const response = await POST(request(validBody, { "idempotency-key": "" }));

    expect(response.status).toBe(428);
    expect((await response.json()).code).toBe("IDEMPOTENCY_KEY_REQUIRED");
    expect(mocks.authorizePublicQuoteRequest).toHaveBeenCalledTimes(1);
    expect(mocks.respondToPublicQuote).not.toHaveBeenCalled();
  });

  it("rejects an internal version UUID, total or any unknown field", async () => {
    const response = await POST(
      request({ ...validBody, versionId: crypto.randomUUID(), totalMinor: "1" }),
    );

    expect(response.status).toBe(422);
    expect((await response.json()).code).toBe("VALIDATION_FAILED");
    expect(mocks.authorizePublicQuoteRequest).toHaveBeenCalledTimes(1);
    expect(mocks.respondToPublicQuote).not.toHaveBeenCalled();
  });

  it("applies rate limiting before reading a malformed request body", async () => {
    mocks.authorizePublicQuoteRequest.mockRejectedValue(
      new ApiProblem({
        status: 429,
        code: "RATE_LIMITED",
        title: "要求過於頻繁",
        detail: "操作次數過多，請稍後再試。",
      }),
    );

    const response = await POST(rawRequest("{"));

    expect(response.status).toBe(429);
    expect((await response.json()).code).toBe("RATE_LIMITED");
    expect(mocks.respondToPublicQuote).not.toHaveBeenCalled();
  });

  it("caps the public response body at 16 KiB after authorization", async () => {
    const response = await POST(
      request({ ...validBody, comment: "x".repeat(17 * 1024) }),
    );

    expect(response.status).toBe(413);
    expect((await response.json()).code).toBe("PAYLOAD_TOO_LARGE");
    expect(mocks.authorizePublicQuoteRequest).toHaveBeenCalledTimes(1);
    expect(mocks.respondToPublicQuote).not.toHaveBeenCalled();
  });

  it("never reflects a malformed capability in problem details", async () => {
    const response = await POST(request(validBody, { authorization: "Bearer bad-token" }));
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.instance).toBe("/api/v2/public/quotes/current/responses");
    expect(JSON.stringify(body)).not.toContain("bad-token");
    expect(mocks.authorizePublicQuoteRequest).not.toHaveBeenCalled();
    expect(mocks.respondToPublicQuote).not.toHaveBeenCalled();
  });
});
