import { describe, expect, it, vi } from "vitest";

import {
  computeDashboard,
  finalizeDataDeletion,
  hashReauthToken,
  reportFunnel,
  reportOperations,
  reportRetention,
  requestDataDeletion,
  runRetentionCleanup,
} from "./gateway";

function okRpc(data: unknown) {
  return vi.fn().mockResolvedValue({ data, error: null });
}

describe("reporting gateway", () => {
  it("dashboard forwards the org-local window", async () => {
    const rpc = okRpc({ window: {}, metrics: {} });
    await computeDashboard({
      supabase: { rpc } as never,
      organizationId: "org-1",
      from: "2026-06-01",
      to: "2026-06-30",
    });
    expect(rpc).toHaveBeenCalledWith("compute_pilot_dashboard", {
      target_org: "org-1",
      p_from: "2026-06-01",
      p_to: "2026-06-30",
    });
  });

  it("reports delegate to their RPCs", async () => {
    const funnel = okRpc({ stages: {} });
    const ops = okRpc({ workOrders: {}, payments: {}, includeAmounts: false });
    const retention = okRpc({ activePlans: 0 });
    await reportFunnel({ supabase: { rpc: funnel } as never, organizationId: "org-1" });
    await reportOperations({ supabase: { rpc: ops } as never, organizationId: "org-1" });
    await reportRetention({ supabase: { rpc: retention } as never, organizationId: "org-1" });
    expect(funnel).toHaveBeenCalledWith("report_funnel", expect.any(Object));
    expect(ops).toHaveBeenCalledWith("report_operations", expect.any(Object));
    expect(retention).toHaveBeenCalledWith("report_retention", expect.any(Object));
  });

  it("hashes the reauth token before it reaches the RPC (raw never sent)", async () => {
    const rpc = okRpc({ deletionRequestId: "d1", status: "requested" });
    await requestDataDeletion({
      supabase: { rpc } as never,
      organizationId: "org-1",
      reauthToken: "super-secret-pass",
      requestId: "req-1",
    });
    const call = rpc.mock.calls[0][1] as Record<string, unknown>;
    expect(call.p_reauth_token_hash_hex).toBe(hashReauthToken("super-secret-pass"));
    expect(JSON.stringify(call)).not.toContain("super-secret-pass");
  });

  it("finalize forwards the request id and hashed token", async () => {
    const rpc = okRpc({ deletionRequestId: "d1", status: "finalized", replayed: false });
    await finalizeDataDeletion({
      supabase: { rpc } as never,
      organizationId: "org-1",
      deletionRequestId: "d1",
      reauthToken: "super-secret-pass",
      requestId: "req-1",
    });
    expect(rpc).toHaveBeenCalledWith(
      "finalize_pilot_data_deletion",
      expect.objectContaining({
        p_deletion_request_id: "d1",
        p_reauth_token_hash_hex: hashReauthToken("super-secret-pass"),
      }),
    );
  });

  it("maps a reauth mismatch to a 403", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: null, error: { message: "DATA_DELETION_REAUTH_INVALID" } });
    await expect(
      finalizeDataDeletion({
        supabase: { rpc } as never,
        organizationId: "org-1",
        deletionRequestId: "d1",
        reauthToken: "wrong",
        requestId: "req-1",
      }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("retention cleanup returns the counts", async () => {
    const rpc = okRpc({ purgedPhotos: 1, strippedWebhooks: 2, cleanedExports: 0 });
    expect(await runRetentionCleanup({ supabase: { rpc } as never })).toEqual({
      purgedPhotos: 1,
      strippedWebhooks: 2,
      cleanedExports: 0,
    });
  });
});
