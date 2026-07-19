import { describe, expect, it } from "vitest";

import { GET } from "@/app/api/v2/health/route";

describe("GET /api/v2/health", () => {
  it("returns the v2 health contract without cacheable or secret data", async () => {
    const request = new Request("http://localhost/api/v2/health", {
      headers: { "x-request-id": "67427c45-e326-4a0a-b7b7-82cf53999df7" },
    });

    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-request-id")).toBe("67427c45-e326-4a0a-b7b7-82cf53999df7");
    const body = await response.json();
    expect(body).toEqual({
      data: {
        status: "ok",
        version: "v2",
        time: expect.any(String),
      },
    });
    expect(Number.isFinite(Date.parse(body.data.time))).toBe(true);
  });

  it("replaces an invalid caller request id with a safe generated id", async () => {
    const response = await GET(
      new Request("http://localhost/api/v2/health", {
        headers: { "x-request-id": "contains unsafe spaces" },
      }),
    );

    expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
  });
});
