import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

const CRON = "cron-secret-value";
const WORKER = "worker-secret-value";

function request(auth?: string): Request {
  return new Request("https://app.renoly.test/api/cron/daily", {
    method: "GET",
    headers: auth ? { authorization: auth } : {},
  });
}

describe("GET /api/cron/daily", () => {
  beforeEach(() => {
    vi.stubEnv("CRON_SECRET", CRON);
    vi.stubEnv("WORKER_SECRET", WORKER);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 200 })),
    );
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("rejects a request without the cron bearer", async () => {
    const response = await GET(request());
    expect(response.status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects a wrong cron secret", async () => {
    const response = await GET(request("Bearer nope"));
    expect(response.status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("fails closed when secrets are unconfigured", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const response = await GET(request(`Bearer ${CRON}`));
    expect(response.status).toBe(500);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("dispatches every worker with the WORKER_SECRET bearer on a valid cron call", async () => {
    const response = await GET(request(`Bearer ${CRON}`));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ran).toBe(6);
    // Each worker is POSTed with the worker bearer.
    expect(fetch).toHaveBeenCalledTimes(6);
    const [, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(init.method).toBe("POST");
    expect(init.headers.authorization).toBe(`Bearer ${WORKER}`);
  });

  it("records a failing worker without aborting the rest", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockRejectedValueOnce(new Error("boom"))
        .mockResolvedValue(new Response("{}", { status: 200 })),
    );
    const response = await GET(request(`Bearer ${CRON}`));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.results[0].status).toBe("error");
    expect(body.ran).toBe(6);
  });
});
