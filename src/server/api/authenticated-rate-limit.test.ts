import { describe, expect, it, vi } from "vitest";

import { consumeAuthenticatedRateLimit } from "./authenticated-rate-limit";

describe("consumeAuthenticatedRateLimit", () => {
  it("passes on an 'ok' status", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: "ok", error: null });
    await expect(
      consumeAuthenticatedRateLimit({
        supabase: { rpc } as never,
        organizationId: "org-1",
        userId: "user-1",
        action: "mutation",
      }),
    ).resolves.toBeUndefined();
    expect(rpc).toHaveBeenCalledWith("consume_pilot_authenticated_rate_limit", {
      p_organization_id: "org-1",
      p_user_id: "user-1",
      p_action: "mutation",
    });
  });

  it("throws a 429 on 'limited'", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: "limited", error: null });
    await expect(
      consumeAuthenticatedRateLimit({
        supabase: { rpc } as never,
        organizationId: "org-1",
        userId: "user-1",
        action: "read",
      }),
    ).rejects.toMatchObject({ status: 429 });
  });

  it("throws a 500 on an RPC error", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: "boom" } });
    await expect(
      consumeAuthenticatedRateLimit({
        supabase: { rpc } as never,
        organizationId: "org-1",
        userId: "user-1",
        action: "search_report",
      }),
    ).rejects.toMatchObject({ status: 500 });
  });
});
