import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAdminSupabaseClient: vi.fn(),
  createAiExtractor: vi.fn(),
  runClaimedExtractions: vi.fn(),
}));

vi.mock("@/server/supabase/admin", () => ({
  createAdminSupabaseClient: mocks.createAdminSupabaseClient,
}));
vi.mock("@/server/integrations/ai/factory", () => ({
  createAiExtractor: mocks.createAiExtractor,
}));
vi.mock("@/server/intake/gateway", () => ({
  runClaimedExtractions: mocks.runClaimedExtractions,
}));

import { POST } from "./route";

const WORKER_SECRET = "worker-secret-value-abcdefghijklmnop";

function request(headers: Record<string, string> = {}, rawBody?: string): Request {
  return new Request("http://localhost/api/v2/internal/workers/intake-extraction", {
    method: "POST",
    headers,
    body: rawBody,
  });
}

function authHeaders(extra: Record<string, string> = {}) {
  return { authorization: `Bearer ${WORKER_SECRET}`, ...extra };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.WORKER_SECRET = WORKER_SECRET;
  mocks.createAdminSupabaseClient.mockReturnValue({ rpc: vi.fn() });
  mocks.createAiExtractor.mockReturnValue({ extract: vi.fn() });
  mocks.runClaimedExtractions.mockResolvedValue({ claimed: 3, succeeded: 2, degraded: 1 });
});

describe("POST /api/v2/internal/workers/intake-extraction", () => {
  it("rejects a request without the worker bearer secret (401) and never runs", async () => {
    const response = await POST(request());
    expect(response.status).toBe(401);
    expect(mocks.runClaimedExtractions).not.toHaveBeenCalled();
  });

  it("rejects a wrong secret (401)", async () => {
    const response = await POST(request({ authorization: "Bearer nope-wrong-secret-value-xxxx" }));
    expect(response.status).toBe(401);
    expect(mocks.runClaimedExtractions).not.toHaveBeenCalled();
  });

  it("runs a pass and returns the extraction summary (200)", async () => {
    const response = await POST(
      request(authHeaders({ "content-type": "application/json" }), JSON.stringify({ limit: 5 })),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toEqual({ claimed: 3, succeeded: 2, degraded: 1 });
    expect(mocks.runClaimedExtractions).toHaveBeenCalledTimes(1);
    expect(mocks.runClaimedExtractions.mock.calls[0][0].limit).toBe(5);
    expect(mocks.runClaimedExtractions.mock.calls[0][0].workerId).toMatch(/^intake-extraction:/);
  });

  it("accepts a JSON content-type with an empty body (no limit)", async () => {
    const response = await POST(
      request(authHeaders({ "content-type": "application/json" }), "   "),
    );
    expect(response.status).toBe(200);
    expect(mocks.runClaimedExtractions.mock.calls[0][0].limit).toBeUndefined();
  });

  it("skips body parsing entirely for a non-JSON content-type", async () => {
    const response = await POST(
      request(authHeaders({ "content-type": "text/plain" }), "ignored"),
    );
    expect(response.status).toBe(200);
    expect(mocks.runClaimedExtractions.mock.calls[0][0].limit).toBeUndefined();
  });

  it("returns 400 (MALFORMED_REQUEST) for a JSON body that is not valid JSON", async () => {
    const response = await POST(
      request(authHeaders({ "content-type": "application/json" }), "{not json"),
    );
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("MALFORMED_REQUEST");
    expect(mocks.runClaimedExtractions).not.toHaveBeenCalled();
  });

  it("returns 422 for a limit that violates the schema (above max)", async () => {
    const response = await POST(
      request(authHeaders({ "content-type": "application/json" }), JSON.stringify({ limit: 999 })),
    );
    expect(response.status).toBe(422);
    expect(mocks.runClaimedExtractions).not.toHaveBeenCalled();
  });

  it("returns 422 for an unknown key in a strict body", async () => {
    const response = await POST(
      request(authHeaders({ "content-type": "application/json" }), JSON.stringify({ bogus: 1 })),
    );
    expect(response.status).toBe(422);
    expect(mocks.runClaimedExtractions).not.toHaveBeenCalled();
  });

  it("maps an unexpected gateway failure to a non-leaky 500", async () => {
    mocks.runClaimedExtractions.mockRejectedValue(new Error("claim rpc failed"));

    const response = await POST(request(authHeaders({ "content-type": "application/json" })));
    expect(response.status).toBe(500);
  });
});
