import { afterEach, describe, expect, it, vi } from "vitest";

import {
  configuredAppOrigin,
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
  verifyCsrf,
} from "./csrf";

const APP_ORIGIN = "https://app.renoly.test";

function makeRequest(
  headers: Record<string, string>,
  cookies: Record<string, string> = {},
): Request {
  const cookieHeader = Object.entries(cookies)
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
  return new Request(`${APP_ORIGIN}/api/v2/organizations`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookieHeader ? { cookie: cookieHeader } : {}),
      ...headers,
    },
  });
}

describe("configuredAppOrigin", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("prefers a validated NEXT_PUBLIC_APP_URL over the request URL", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.renoly.tw");
    const request = new Request("http://localhost:3000/api/v2/organizations");
    expect(configuredAppOrigin(request)).toBe("https://app.renoly.tw");
  });

  it("falls back to the request URL origin outside production", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    vi.stubEnv("NODE_ENV", "development");
    const request = new Request("http://127.0.0.1:3100/api/v2/organizations");
    expect(configuredAppOrigin(request)).toBe("http://127.0.0.1:3100");
  });

  it("fails loudly in production when NEXT_PUBLIC_APP_URL is missing", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    vi.stubEnv("NODE_ENV", "production");
    const request = new Request("https://app.renoly.tw/api/v2/organizations");
    expect(() => configuredAppOrigin(request)).toThrow(
      expect.objectContaining({ status: 500, code: "CONFIG_INVALID" }),
    );
  });
});

describe("verifyCsrf", () => {
  const token = "a".repeat(43);

  it("accepts a request with a matching double-submit token and a same-origin Origin", () => {
    const request = makeRequest(
      { origin: APP_ORIGIN, [CSRF_HEADER_NAME]: token },
      { [CSRF_COOKIE_NAME]: token },
    );
    expect(() => verifyCsrf(request, APP_ORIGIN)).not.toThrow();
  });

  it("accepts a same-origin Host fallback when no Origin header is present", () => {
    const request = new Request(`${APP_ORIGIN}/api/v2/organizations`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        host: "app.renoly.test",
        "sec-fetch-site": "same-origin",
        cookie: `${CSRF_COOKIE_NAME}=${token}`,
        [CSRF_HEADER_NAME]: token,
      },
    });
    expect(() => verifyCsrf(request, APP_ORIGIN)).not.toThrow();
  });

  it("rejects a cross-origin Origin", () => {
    const request = makeRequest(
      { origin: "https://evil.example", [CSRF_HEADER_NAME]: token },
      { [CSRF_COOKIE_NAME]: token },
    );
    expect(() => verifyCsrf(request, APP_ORIGIN)).toThrow(
      expect.objectContaining({ status: 403, code: "CSRF_INVALID" }),
    );
  });

  it("rejects a missing CSRF header", () => {
    const request = makeRequest({ origin: APP_ORIGIN }, { [CSRF_COOKIE_NAME]: token });
    expect(() => verifyCsrf(request, APP_ORIGIN)).toThrow(
      expect.objectContaining({ status: 403, code: "CSRF_INVALID" }),
    );
  });

  it("rejects a missing CSRF cookie", () => {
    const request = makeRequest({ origin: APP_ORIGIN, [CSRF_HEADER_NAME]: token });
    expect(() => verifyCsrf(request, APP_ORIGIN)).toThrow(
      expect.objectContaining({ status: 403, code: "CSRF_INVALID" }),
    );
  });

  it("rejects a header that does not match the cookie", () => {
    const request = makeRequest(
      { origin: APP_ORIGIN, [CSRF_HEADER_NAME]: token },
      { [CSRF_COOKIE_NAME]: "b".repeat(43) },
    );
    expect(() => verifyCsrf(request, APP_ORIGIN)).toThrow(
      expect.objectContaining({ status: 403, code: "CSRF_INVALID" }),
    );
  });

  it("rejects a token that is too short to be a real CSRF value", () => {
    const request = makeRequest(
      { origin: APP_ORIGIN, [CSRF_HEADER_NAME]: "short" },
      { [CSRF_COOKIE_NAME]: "short" },
    );
    expect(() => verifyCsrf(request, APP_ORIGIN)).toThrow(
      expect.objectContaining({ status: 403, code: "CSRF_INVALID" }),
    );
  });

  it("uses a constant-time comparison that still rejects unequal-length values", () => {
    const request = makeRequest(
      { origin: APP_ORIGIN, [CSRF_HEADER_NAME]: token },
      { [CSRF_COOKIE_NAME]: `${token}extra` },
    );
    expect(() => verifyCsrf(request, APP_ORIGIN)).toThrow(
      expect.objectContaining({ status: 403, code: "CSRF_INVALID" }),
    );
  });
});
