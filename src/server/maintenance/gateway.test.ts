import { describe, expect, it, vi } from "vitest";

import {
  approveNotifications,
  cancelMaintenancePlan,
  completeMaintenancePlan,
  convertMaintenancePlanToRequest,
  createMaintenancePlan,
  getMaintenancePlanDetail,
  listMaintenancePlans,
  patchMaintenancePlan,
  pauseMaintenancePlan,
  prepareMaintenanceReminders,
  resumeMaintenancePlan,
  scanMaintenanceDue,
} from "./gateway";

function okRpc(data: unknown) {
  return vi.fn().mockResolvedValue({ data, error: null });
}

describe("maintenance gateway", () => {
  it("creates a plan with cadence and next_due_on", async () => {
    const rpc = okRpc({ id: "plan-1" });
    await createMaintenancePlan({
      supabase: { rpc } as never,
      organizationId: "org-1",
      input: {
        customerId: "c1",
        locationId: "l1",
        name: "半年保養",
        cadenceMonths: 6,
        nextDueOn: "2026-08-01",
      },
      requestId: "req-1",
    });
    expect(rpc).toHaveBeenCalledWith(
      "create_maintenance_plan",
      expect.objectContaining({
        p_cadence_months: 6,
        p_next_due_on: "2026-08-01",
        p_lead_days: 14,
        p_auto_prepare_message: true,
      }),
    );
  });

  it("patch forwards the lock version and nullable fields", async () => {
    const rpc = okRpc({ id: "plan-1" });
    await patchMaintenancePlan({
      supabase: { rpc } as never,
      organizationId: "org-1",
      planId: "plan-1",
      expectedLockVersion: 2,
      input: { cadenceMonths: 12 },
      requestId: "req-1",
    });
    expect(rpc).toHaveBeenCalledWith(
      "patch_maintenance_plan",
      expect.objectContaining({ p_expected_lock_version: 2, p_cadence_months: 12 }),
    );
  });

  it("pause and resume delegate to their RPCs", async () => {
    const rpc = okRpc({ id: "plan-1", status: "paused" });
    await pauseMaintenancePlan({
      supabase: { rpc } as never,
      organizationId: "org-1",
      planId: "plan-1",
      expectedLockVersion: 1,
      requestId: "req-1",
    });
    await resumeMaintenancePlan({
      supabase: { rpc } as never,
      organizationId: "org-1",
      planId: "plan-1",
      expectedLockVersion: 2,
      requestId: "req-1",
    });
    expect(rpc).toHaveBeenNthCalledWith(1, "pause_maintenance_plan", expect.any(Object));
    expect(rpc).toHaveBeenNthCalledWith(2, "resume_maintenance_plan", expect.any(Object));
  });

  it("cancel requires a reason", async () => {
    const rpc = okRpc({ id: "plan-1", status: "cancelled" });
    await cancelMaintenancePlan({
      supabase: { rpc } as never,
      organizationId: "org-1",
      planId: "plan-1",
      expectedLockVersion: 1,
      reason: "客戶不續約",
      requestId: "req-1",
    });
    expect(rpc).toHaveBeenCalledWith(
      "cancel_maintenance_plan",
      expect.objectContaining({ p_reason: "客戶不續約" }),
    );
  });

  it("complete recomputes next due via the RPC", async () => {
    const rpc = okRpc({ id: "plan-1", nextDueOn: "2027-02-01" });
    await completeMaintenancePlan({
      supabase: { rpc } as never,
      organizationId: "org-1",
      planId: "plan-1",
      expectedLockVersion: 1,
      input: { completedWorkOrderId: "wo-1" },
      requestId: "req-1",
    });
    expect(rpc).toHaveBeenCalledWith(
      "complete_maintenance_plan",
      expect.objectContaining({ p_completed_work_order_id: "wo-1" }),
    );
  });

  it("prepareMaintenanceReminders enqueues drafts only", async () => {
    const rpc = okRpc({ prepared: 2, skipped: 0 });
    const result = await prepareMaintenanceReminders({
      supabase: { rpc } as never,
      organizationId: "org-1",
      input: { planIds: ["plan-1", "plan-2"] },
      requestId: "req-1",
    });
    expect(result).toEqual({ prepared: 2, skipped: 0 });
  });

  it("approveNotifications forwards the batch", async () => {
    const rpc = okRpc({ approved: 3 });
    await approveNotifications({
      supabase: { rpc } as never,
      organizationId: "org-1",
      input: { notificationIds: ["n1", "n2", "n3"] },
      requestId: "req-1",
    });
    expect(rpc).toHaveBeenCalledWith(
      "approve_notifications",
      expect.objectContaining({ p_notification_ids: ["n1", "n2", "n3"] }),
    );
  });

  it("convert forwards force and idempotency and maps an open-request conflict", async () => {
    const okRpcFn = okRpc({ serviceRequestId: "sr-1", replayed: false });
    await convertMaintenancePlanToRequest({
      supabase: { rpc: okRpcFn } as never,
      organizationId: "org-1",
      planId: "plan-1",
      expectedLockVersion: 1,
      input: { force: true },
      idempotencyKey: "idem-abc12345",
      requestId: "req-1",
    });
    expect(okRpcFn).toHaveBeenCalledWith(
      "convert_maintenance_plan_to_request",
      expect.objectContaining({ p_force: true }),
    );

    const conflictRpc = vi
      .fn()
      .mockResolvedValue({ data: null, error: { code: "RENOP", message: "ASSET_HAS_OPEN_REQUEST" } });
    await expect(
      convertMaintenancePlanToRequest({
        supabase: { rpc: conflictRpc } as never,
        organizationId: "org-1",
        planId: "plan-1",
        expectedLockVersion: 1,
        input: {},
        idempotencyKey: "idem-abc12345",
        requestId: "req-1",
      }),
    ).rejects.toMatchObject({ status: 409, code: "OPEN_REQUEST_CONFLICT" });
  });

  it("list and detail return their envelopes", async () => {
    const listRpc = okRpc({ plans: [] });
    expect(
      await listMaintenancePlans({ supabase: { rpc: listRpc } as never, organizationId: "org-1" }),
    ).toEqual({ plans: [] });
    const detailRpc = okRpc({ id: "plan-1" });
    expect(
      await getMaintenancePlanDetail({
        supabase: { rpc: detailRpc } as never,
        organizationId: "org-1",
        planId: "plan-1",
      }),
    ).toEqual({ id: "plan-1" });
  });

  it("scanMaintenanceDue returns enqueued/skipped counts", async () => {
    const rpc = okRpc({ enqueued: 1, skipped: 0 });
    expect(await scanMaintenanceDue({ supabase: { rpc } as never })).toEqual({
      enqueued: 1,
      skipped: 0,
    });
  });
});
