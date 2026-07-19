import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const supabaseMocks = vi.hoisted(() => ({
  exchangeCodeForSession: vi.fn(),
  createSupabaseServerClient: vi.fn(),
}));

vi.mock("@/server/supabase/server", () => ({
  createSupabaseServerClient: supabaseMocks.createSupabaseServerClient,
}));

import { GET } from "./route";

describe("GET /auth/callback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    supabaseMocks.createSupabaseServerClient.mockResolvedValue({
      auth: { exchangeCodeForSession: supabaseMocks.exchangeCodeForSession },
    });
    supabaseMocks.exchangeCodeForSession.mockResolvedValue({
      data: { session: { access_token: "do-not-return" } },
      error: null,
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("exchanges the PKCE code and redirects to the internal staff app", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.renoly.test");
    const response = await GET(
      new Request(
        "https://app.renoly.test/auth/callback?code=one-time-code&next=%2Fapp%2Finbox",
      ),
    );

    expect(supabaseMocks.exchangeCodeForSession).toHaveBeenCalledWith(
      "one-time-code",
    );
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://app.renoly.test/app/inbox",
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("location")).not.toContain("do-not-return");
  });

  it("never flips the request host to localhost on success (D1)", async () => {
    vi.stubEnv("NODE_ENV", "development");
    // request.url reports localhost in Next dev, but the browser is on 127.0.0.1.
    const response = await GET(
      new Request("http://localhost:3100/auth/callback?code=one-time-code", {
        headers: { host: "127.0.0.1:3100" },
      }),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "http://127.0.0.1:3100/app",
    );
  });

  it("keeps the browser host when returning to login on missing code (D1)", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const response = await GET(
      new Request("http://localhost:3100/auth/callback", {
        headers: { host: "127.0.0.1:3100" },
      }),
    );

    expect(response.headers.get("location")).toBe(
      "http://127.0.0.1:3100/login?error=auth_callback",
    );
  });

  it.each([
    "https://attacker.example/phish",
    "//attacker.example/phish",
    "/demo",
    "/application",
  ])("does not redirect to an unapproved next target: %s", async (next) => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.renoly.test");
    const url = new URL("https://app.renoly.test/auth/callback");
    url.searchParams.set("code", "one-time-code");
    url.searchParams.set("next", next);

    const response = await GET(new Request(url));

    expect(response.headers.get("location")).toBe(
      "https://app.renoly.test/app",
    );
  });

  it("returns to login with a generic error when the code exchange fails", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.renoly.test");
    supabaseMocks.exchangeCodeForSession.mockResolvedValue({
      data: { session: null },
      error: { message: "provider detail" },
    });

    const response = await GET(
      new Request(
        "https://app.renoly.test/auth/callback?code=bad-code&next=%2Fapp",
      ),
    );

    expect(response.headers.get("location")).toBe(
      "https://app.renoly.test/login?error=auth_callback",
    );
    expect(response.headers.get("location")).not.toContain("provider");
  });
});
