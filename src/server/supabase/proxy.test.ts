import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const ssrMocks = vi.hoisted(() => ({
  createServerClient: vi.fn(),
  getUser: vi.fn(),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: ssrMocks.createServerClient,
}));

import { updateSupabaseSession } from "./proxy";

describe("updateSupabaseSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-test-key";
    ssrMocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    ssrMocks.createServerClient.mockImplementation((_url, _key, options) => ({
      auth: {
        getUser: async () => {
          options.cookies.setAll(
            [
              {
                name: "sb-session",
                value: "refreshed",
                options: { path: "/", httpOnly: true, sameSite: "lax" },
              },
            ],
            { "Cache-Control": "private, no-store", Pragma: "no-cache" },
          );
          return ssrMocks.getUser();
        },
      },
    }));
  });

  it("refreshes cookies but redirects an unauthenticated staff request to login", async () => {
    const response = await updateSupabaseSession(
      new NextRequest("https://app.renoly.test/app/inbox"),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://app.renoly.test/login?next=%2Fapp%2Finbox",
    );
    expect(response.headers.get("set-cookie")).toContain("sb-session=refreshed");
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("allows a verified staff request and keeps refreshed auth response headers", async () => {
    ssrMocks.getUser.mockResolvedValue({
      data: { user: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" } },
      error: null,
    });

    const response = await updateSupabaseSession(
      new NextRequest("https://app.renoly.test/app"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("pragma")).toBe("no-cache");
  });
});
