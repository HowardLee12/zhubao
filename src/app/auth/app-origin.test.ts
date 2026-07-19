import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { applicationOrigin, safeStaffPath } from "./app-origin";

describe("applicationOrigin", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("prefers a validated NEXT_PUBLIC_APP_URL over any request host", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.renoly.test");
    const request = new Request("http://localhost:3100/auth/callback", {
      headers: {
        host: "localhost:3100",
        "x-forwarded-host": "attacker.example",
      },
    });

    expect(applicationOrigin(request)).toBe("https://app.renoly.test");
  });

  it("ignores a NEXT_PUBLIC_APP_URL with an unsupported protocol", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "ftp://app.renoly.test");
    vi.stubEnv("NODE_ENV", "development");
    const request = new Request("http://127.0.0.1:3100/auth/callback", {
      headers: { host: "127.0.0.1:3100" },
    });

    expect(applicationOrigin(request)).toBe("http://127.0.0.1:3100");
  });

  it("derives the origin from the request host when app url is unset", () => {
    vi.stubEnv("NODE_ENV", "development");
    const request = new Request("http://127.0.0.1:3100/auth/callback", {
      headers: { host: "127.0.0.1:3100" },
    });

    expect(applicationOrigin(request)).toBe("http://127.0.0.1:3100");
  });

  it("never flips the request host to localhost", () => {
    vi.stubEnv("NODE_ENV", "development");
    const request = new Request("http://localhost:3100/auth/callback", {
      headers: { host: "127.0.0.1:3100" },
    });

    // request.url reports localhost in Next dev, but the Host header wins.
    expect(applicationOrigin(request)).toBe("http://127.0.0.1:3100");
  });

  it("prefers x-forwarded-host and x-forwarded-proto behind a proxy", () => {
    vi.stubEnv("NODE_ENV", "production");
    const request = new Request("http://internal:3000/auth/callback", {
      headers: {
        host: "internal:3000",
        "x-forwarded-host": "app.renoly.test",
        "x-forwarded-proto": "https",
      },
    });

    expect(applicationOrigin(request)).toBe("https://app.renoly.test");
  });

  it("rejects a host header with invalid characters and falls back in dev", () => {
    vi.stubEnv("NODE_ENV", "development");
    const request = new Request("http://127.0.0.1:3100/auth/callback", {
      headers: { host: "attacker.example/../evil" },
    });

    expect(applicationOrigin(request)).toBe("http://localhost:3000");
  });

  it("takes only the first x-forwarded-host entry", () => {
    vi.stubEnv("NODE_ENV", "production");
    const request = new Request("http://internal/auth/callback", {
      headers: {
        host: "internal",
        "x-forwarded-host": "app.renoly.test, attacker.example",
        "x-forwarded-proto": "https, http",
      },
    });

    expect(applicationOrigin(request)).toBe("https://app.renoly.test");
  });

  it("falls back to localhost dev origin when no host is resolvable", () => {
    vi.stubEnv("NODE_ENV", "development");
    const request = new Request("http://internal/auth/callback");
    // Strip the host header that Request adds implicitly.
    const headers = new Headers(request.headers);
    headers.delete("host");
    const stripped = new Request(request.url, { headers });

    expect(applicationOrigin(stripped)).toBe("http://localhost:3000");
  });

  it("throws in production when neither app url nor request host resolve", () => {
    vi.stubEnv("NODE_ENV", "production");
    const request = new Request("http://internal/auth/callback");
    const headers = new Headers(request.headers);
    headers.delete("host");
    const stripped = new Request(request.url, { headers });

    expect(() => applicationOrigin(stripped)).toThrow();
  });

  it("supports being called with no request (config-only origin)", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.renoly.test");

    expect(applicationOrigin()).toBe("https://app.renoly.test");
  });
});

describe("safeStaffPath", () => {
  it("returns the default staff path for a null candidate", () => {
    expect(safeStaffPath(null)).toBe("/app");
  });

  it("keeps an approved deep link with search and hash", () => {
    expect(safeStaffPath("/app/inbox?filter=new#top")).toBe(
      "/app/inbox?filter=new#top",
    );
  });

  it.each([
    "https://attacker.example/phish",
    "//attacker.example/phish",
    "/demo",
    "/application",
    "/app\\evil",
  ])("rejects an unapproved candidate: %s", (candidate) => {
    expect(safeStaffPath(candidate)).toBe("/app");
  });
});
