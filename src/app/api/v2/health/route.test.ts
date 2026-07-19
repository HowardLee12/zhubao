import { describe, expect, it } from "vitest";

import { GET } from "./route";

describe("GET /api/v2/health", () => {
  it("returns a no-store service health envelope and request id", async () => {
    const requestId = "67427c45-e326-4a0a-b7b7-82cf53999df7";
    const response = await GET(
      new Request("https://renoly.test/api/v2/health", {
        headers: { "x-request-id": requestId },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-request-id")).toBe(requestId);
    const body = await response.json();
    expect(body).toEqual({
      data: { status: "ok", version: "v2", time: expect.any(String) },
    });
    expect(Number.isFinite(Date.parse(body.data.time))).toBe(true);
  });
});
