import { afterEach, describe, expect, it, vi } from "vitest";

const { rpc, createAdminSupabaseClient } = vi.hoisted(() => {
  const rpc = vi.fn();
  return { rpc, createAdminSupabaseClient: vi.fn(() => ({ rpc })) };
});

vi.mock("@/server/supabase/admin", () => ({ createAdminSupabaseClient }));

import { POST } from "./route";

const OLD_SECRET = process.env.WORKER_SECRET;

afterEach(() => {
  vi.clearAllMocks();
  process.env.WORKER_SECRET = OLD_SECRET;
});

describe("payment-overdue worker route", () => {
  it("rejects a request without the worker bearer BEFORE any RPC runs", async () => {
    process.env.WORKER_SECRET = "test-worker-secret-value";
    const response = await POST(new Request("https://renoly.test/x", { method: "POST" }));
    expect(response.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("flips overdue milestones and returns the count", async () => {
    process.env.WORKER_SECRET = "test-worker-secret-value";
    rpc.mockResolvedValue({ data: { markedOverdue: 2 }, error: null });

    const response = await POST(
      new Request("https://renoly.test/x", {
        method: "POST",
        headers: { authorization: "Bearer test-worker-secret-value" },
      }),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.markedOverdue).toBe(2);
    expect(rpc).toHaveBeenCalledWith("mark_payments_overdue", expect.any(Object));
  });
});
