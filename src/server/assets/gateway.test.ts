import { describe, expect, it, vi } from "vitest";

import {
  appendAssetServiceEvent,
  getAssetHistory,
  patchAsset,
  retireAsset,
} from "./gateway";

function okRpc(data: unknown) {
  return vi.fn().mockResolvedValue({ data, error: null });
}

describe("assets gateway", () => {
  it("patch forwards the lock version and nullable attributes", async () => {
    const rpc = okRpc({ id: "a1" });
    await patchAsset({
      supabase: { rpc } as never,
      organizationId: "org-1",
      assetId: "a1",
      expectedLockVersion: 2,
      input: { brand: "Daikin", model: "RXM" },
      requestId: "req-1",
    });
    expect(rpc).toHaveBeenCalledWith(
      "patch_asset",
      expect.objectContaining({ p_brand: "Daikin", p_model: "RXM", p_expected_lock_version: 2 }),
    );
  });

  it("retire soft-deletes via the RPC", async () => {
    const rpc = okRpc({ id: "a1", status: "retired" });
    await retireAsset({
      supabase: { rpc } as never,
      organizationId: "org-1",
      assetId: "a1",
      expectedLockVersion: 1,
      input: { reason: "汰換" },
      requestId: "req-1",
    });
    expect(rpc).toHaveBeenCalledWith(
      "retire_asset",
      expect.objectContaining({ p_reason: "汰換" }),
    );
  });

  it("maps a retired-asset conflict to a 409", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: null, error: { message: "ASSET_RETIRED" } });
    await expect(
      appendAssetServiceEvent({
        supabase: { rpc } as never,
        organizationId: "org-1",
        assetId: "a1",
        input: { eventType: "serviced", summary: "清洗完成" },
        requestId: "req-1",
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("append forwards the event type and summary", async () => {
    const rpc = okRpc({ assetId: "a1", eventId: "e1" });
    await appendAssetServiceEvent({
      supabase: { rpc } as never,
      organizationId: "org-1",
      assetId: "a1",
      input: { eventType: "repaired", summary: "更換壓縮機", workOrderId: "wo-1" },
      requestId: "req-1",
    });
    expect(rpc).toHaveBeenCalledWith(
      "append_asset_service_event",
      expect.objectContaining({ p_event_type: "repaired", p_work_order_id: "wo-1" }),
    );
  });

  it("history returns the merged projection", async () => {
    const rpc = okRpc({ asset: { id: "a1" }, events: [], workOrders: [] });
    const result = await getAssetHistory({
      supabase: { rpc } as never,
      organizationId: "org-1",
      assetId: "a1",
    });
    expect(result).toHaveProperty("events");
    expect(result).toHaveProperty("workOrders");
  });
});
