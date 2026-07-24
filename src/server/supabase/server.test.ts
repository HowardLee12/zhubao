import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const serverMocks = vi.hoisted(() => ({
  createServerClient: vi.fn(),
  cookies: vi.fn(),
  getAll: vi.fn(),
  set: vi.fn(),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: serverMocks.createServerClient,
}));
vi.mock("next/headers", () => ({ cookies: serverMocks.cookies }));

import { createSupabaseServerClient } from "./server";

describe("createSupabaseServerClient", () => {
  const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const originalAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
    serverMocks.cookies.mockResolvedValue({
      getAll: serverMocks.getAll,
      set: serverMocks.set,
    });
    serverMocks.getAll.mockReturnValue([{ name: "sb-old", value: "value" }]);
    serverMocks.createServerClient.mockReturnValue({ kind: "ssr-client" });
  });

  afterEach(() => {
    if (originalUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
    if (originalAnonKey === undefined) {
      delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    } else {
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = originalAnonKey;
    }
  });

  it("uses request-scoped PKCE cookies that client JavaScript cannot read", async () => {
    const result = await createSupabaseServerClient();

    expect(result).toEqual({ kind: "ssr-client" });
    const options = serverMocks.createServerClient.mock.calls[0][2];
    expect(options.cookieOptions).toMatchObject({
      path: "/",
      httpOnly: true,
      sameSite: "lax",
    });
    expect(options.cookies.getAll()).toEqual([
      { name: "sb-old", value: "value" },
    ]);

    options.cookies.setAll([
      {
        name: "sb-new",
        value: "refreshed",
        options: { path: "/nested", httpOnly: false },
      },
    ]);
    expect(serverMocks.set).toHaveBeenCalledWith(
      "sb-new",
      "refreshed",
      expect.objectContaining({ path: "/", httpOnly: true, sameSite: "lax" }),
    );
  });
});
