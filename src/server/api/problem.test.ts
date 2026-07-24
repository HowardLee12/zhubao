import { describe, expect, it } from "vitest";
import { z } from "zod";

import { ApiProblem, toProblemDetails } from "./problem";

describe("toProblemDetails", () => {
  const context = {
    instance: "/api/v2/organizations/org/work-orders",
    requestId: "67427c45-e326-4a0a-b7b7-82cf53999df7",
  };

  it("serializes a known API problem using the stable RFC 7807 envelope", () => {
    const result = toProblemDetails(
      new ApiProblem({
        status: 409,
        code: "INVALID_STATE_TRANSITION",
        title: "工單狀態無法變更",
        detail: "目前狀態不接受這個操作。",
      }),
      context,
    );

    expect(result).toEqual({
      type: "https://renoly.app/problems/invalid-state-transition",
      title: "工單狀態無法變更",
      status: 409,
      detail: "目前狀態不接受這個操作。",
      code: "INVALID_STATE_TRANSITION",
      instance: context.instance,
      requestId: context.requestId,
    });
  });

  it("does not expose unexpected error details", () => {
    const result = toProblemDetails(
      new Error("postgres password=do-not-leak relation customers"),
      context,
    );

    expect(result).toMatchObject({
      status: 500,
      code: "INTERNAL_ERROR",
      detail: "系統暫時無法處理要求，請稍後再試。",
    });
    expect(JSON.stringify(result)).not.toContain("password");
    expect(JSON.stringify(result)).not.toContain("customers");
  });

  it("normalizes provider validation codes to the public uppercase contract", () => {
    const parsed = z.object({ name: z.string().min(3) }).safeParse({ name: "a" });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;

    const problem = ApiProblem.fromZod(parsed.error);

    expect(problem.errors).toEqual([
      expect.objectContaining({ path: "name", code: "TOO_SMALL" }),
    ]);
  });
});
