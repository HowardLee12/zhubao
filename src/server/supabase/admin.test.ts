import { afterEach, describe, expect, it, vi } from "vitest";

const supabaseMocks = vi.hoisted(() => ({ createClient: vi.fn() }));

vi.mock("@supabase/supabase-js", () => ({
  createClient: supabaseMocks.createClient,
}));

import { createAdminSupabaseClient } from "./admin";

describe("createAdminSupabaseClient", () => {
  const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const originalServiceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;

  afterEach(() => {
    vi.clearAllMocks();
    if (originalUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
    if (originalServiceRole === undefined) {
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    } else {
      process.env.SUPABASE_SERVICE_ROLE_KEY = originalServiceRole;
    }
  });

  it("requires a server-only service role key and never falls back to anon", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    expect(() => createAdminSupabaseClient()).toThrow(
      "SUPABASE_SERVICE_ROLE_KEY",
    );
    expect(supabaseMocks.createClient).not.toHaveBeenCalled();
  });

  it("creates a non-persistent server client", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-secret";
    const client = { kind: "admin-client" };
    supabaseMocks.createClient.mockReturnValue(client);

    expect(createAdminSupabaseClient()).toBe(client);
    expect(supabaseMocks.createClient).toHaveBeenCalledWith(
      "https://project.supabase.co",
      "service-role-secret",
      {
        auth: { persistSession: false, autoRefreshToken: false },
      },
    );
  });
});
