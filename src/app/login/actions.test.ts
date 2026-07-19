import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const supabaseMocks = vi.hoisted(() => ({
  signInWithOtp: vi.fn(),
  createSupabaseServerClient: vi.fn(),
}));

vi.mock("@/server/supabase/server", () => ({
  createSupabaseServerClient: supabaseMocks.createSupabaseServerClient,
}));

import { requestMagicLink } from "./actions";

describe("requestMagicLink", () => {
  const originalAppUrl = process.env.NEXT_PUBLIC_APP_URL;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_APP_URL = "https://app.renoly.test";
    supabaseMocks.createSupabaseServerClient.mockResolvedValue({
      auth: { signInWithOtp: supabaseMocks.signInWithOtp },
    });
    supabaseMocks.signInWithOtp.mockResolvedValue({ data: {}, error: null });
  });

  afterEach(() => {
    if (originalAppUrl === undefined) {
      delete process.env.NEXT_PUBLIC_APP_URL;
    } else {
      process.env.NEXT_PUBLIC_APP_URL = originalAppUrl;
    }
  });

  function formWith(fields: Record<string, string>): FormData {
    const formData = new FormData();
    for (const [key, value] of Object.entries(fields)) {
      formData.set(key, value);
    }
    return formData;
  }

  it("rejects an invalid email before contacting Supabase", async () => {
    const result = await requestMagicLink(
      { status: "idle" },
      formWith({ email: "not-an-email" }),
    );

    expect(result.status).toBe("error");
    expect(supabaseMocks.signInWithOtp).not.toHaveBeenCalled();
  });

  it("requests a PKCE-compatible magic link with a server-owned callback URL", async () => {
    const result = await requestMagicLink(
      { status: "idle" },
      formWith({ email: "OWNER@Example.com" }),
    );

    expect(result).toEqual({
      status: "success",
      message: "登入連結已寄出，請到信箱完成登入。",
    });
    expect(supabaseMocks.signInWithOtp).toHaveBeenCalledWith({
      email: "owner@example.com",
      options: {
        emailRedirectTo: "https://app.renoly.test/auth/callback?next=%2Fapp",
        shouldCreateUser: true,
      },
    });
  });

  it("propagates an approved deep-link next through the callback URL", async () => {
    await requestMagicLink(
      { status: "idle" },
      formWith({ email: "owner@example.com", next: "/app/quotes/123" }),
    );

    expect(supabaseMocks.signInWithOtp).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          emailRedirectTo:
            "https://app.renoly.test/auth/callback?next=%2Fapp%2Fquotes%2F123",
        }),
      }),
    );
  });

  it.each([
    "https://attacker.example/phish",
    "//attacker.example/phish",
    "/demo",
    "/application",
  ])("never open-redirects via the next field: %s", async (next) => {
    await requestMagicLink(
      { status: "idle" },
      formWith({ email: "owner@example.com", next }),
    );

    expect(supabaseMocks.signInWithOtp).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          emailRedirectTo: "https://app.renoly.test/auth/callback?next=%2Fapp",
        }),
      }),
    );
  });

  it("does not expose Supabase authentication errors", async () => {
    supabaseMocks.signInWithOtp.mockResolvedValue({
      data: {},
      error: { message: "sensitive provider response" },
    });

    const result = await requestMagicLink(
      { status: "idle" },
      formWith({ email: "owner@example.com" }),
    );

    expect(result.status).toBe("error");
    expect(JSON.stringify(result)).not.toContain("sensitive provider response");
  });
});
