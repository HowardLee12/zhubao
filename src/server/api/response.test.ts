import { describe, expect, it } from "vitest";

import { ApiProblem } from "./problem";
import { dataResponse, problemResponse } from "./response";

describe("API response helpers", () => {
  const context = {
    instance: "/api/v2/public/intake/token",
    requestId: "67427c45-e326-4a0a-b7b7-82cf53999df7",
  };

  it("returns a no-store data envelope with a request id", async () => {
    const response = dataResponse({ accepted: true }, { ...context, status: 202 });

    expect(response.status).toBe(202);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-request-id")).toBe(context.requestId);
    expect(await response.json()).toEqual({ data: { accepted: true } });
  });

  it("returns RFC problem JSON without leaking unexpected errors", async () => {
    const response = problemResponse(
      new ApiProblem({
        status: 429,
        code: "RATE_LIMITED",
        title: "要求過於頻繁",
        detail: "請稍後再試。",
      }),
      context,
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
    expect(await response.json()).toMatchObject({
      status: 429,
      code: "RATE_LIMITED",
      requestId: context.requestId,
    });
  });
});
