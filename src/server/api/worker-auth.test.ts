import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { assertWorkerAuthorized, isWorkerAuthorized } from "./worker-auth";
import { ApiProblem } from "./problem";

const SECRET = "super-secret-worker-token-value";

function req(authorization?: string): Request {
  const headers = new Headers();
  if (authorization !== undefined) headers.set("authorization", authorization);
  return new Request("https://renoly.app/api/v2/internal/workers/notification-dispatch", {
    method: "POST",
    headers,
  });
}

let saved: string | undefined;
beforeEach(() => {
  saved = process.env.WORKER_SECRET;
  process.env.WORKER_SECRET = SECRET;
});
afterEach(() => {
  if (saved === undefined) delete process.env.WORKER_SECRET;
  else process.env.WORKER_SECRET = saved;
});

describe("isWorkerAuthorized", () => {
  it("accepts the exact Bearer secret", () => {
    expect(isWorkerAuthorized(req(`Bearer ${SECRET}`))).toBe(true);
  });

  it("rejects a wrong secret", () => {
    expect(isWorkerAuthorized(req("Bearer nope"))).toBe(false);
  });

  it("rejects a secret of a different length without throwing", () => {
    expect(isWorkerAuthorized(req(`Bearer ${SECRET}extra`))).toBe(false);
  });

  it("rejects a missing header", () => {
    expect(isWorkerAuthorized(req())).toBe(false);
  });

  it("rejects a non-Bearer scheme", () => {
    expect(isWorkerAuthorized(req(`Token ${SECRET}`))).toBe(false);
  });

  it("fails closed when WORKER_SECRET is not configured", () => {
    delete process.env.WORKER_SECRET;
    expect(isWorkerAuthorized(req(`Bearer ${SECRET}`))).toBe(false);
  });

  it("fails closed when WORKER_SECRET is a placeholder", () => {
    process.env.WORKER_SECRET = "replace-with-a-real-secret";
    expect(isWorkerAuthorized(req(`Bearer replace-with-a-real-secret`))).toBe(false);
  });
});

describe("assertWorkerAuthorized", () => {
  it("returns void for an authorized request", () => {
    expect(() => assertWorkerAuthorized(req(`Bearer ${SECRET}`))).not.toThrow();
  });

  it("throws a 401 ApiProblem for an unauthorized request", () => {
    try {
      assertWorkerAuthorized(req("Bearer wrong"));
      throw new Error("expected throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiProblem);
      expect((error as ApiProblem).status).toBe(401);
      expect((error as ApiProblem).code).toBe("AUTHENTICATION_REQUIRED");
    }
  });
});
