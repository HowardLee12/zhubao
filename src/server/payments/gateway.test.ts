import { describe, expect, it, vi } from "vitest";

import { ApiProblem } from "@/server/api/problem";
import {
  cancelPaymentMilestone,
  createPaymentMilestone,
  getPaymentMilestoneDetail,
  invoicePaymentMilestone,
  listPaymentMilestones,
  markPaymentMilestonePaid,
  markPaymentsOverdue,
  reversePaymentMilestone,
  waivePaymentMilestone,
} from "./gateway";

function okRpc(data: unknown) {
  return vi.fn().mockResolvedValue({ data, error: null });
}

describe("payments gateway", () => {
  it("creates a milestone with integer minor-unit amount and defaults", async () => {
    const rpc = okRpc({ id: "m1" });
    await createPaymentMilestone({
      supabase: { rpc } as never,
      organizationId: "org-1",
      input: { projectId: "p1", name: "訂金", amountMinor: 5000 },
      requestId: "req-1",
    });
    expect(rpc).toHaveBeenCalledWith(
      "create_payment_milestone",
      expect.objectContaining({
        target_org: "org-1",
        p_project_id: "p1",
        p_amount_minor: 5000,
        p_currency: "TWD",
        p_notes: "",
      }),
    );
  });

  it("passes If-Match lock version and idempotency to invoice", async () => {
    const rpc = okRpc({ id: "m1", status: "invoiced" });
    await invoicePaymentMilestone({
      supabase: { rpc } as never,
      organizationId: "org-1",
      milestoneId: "m1",
      expectedLockVersion: 3,
      input: {},
      idempotencyKey: "idem-abc12345",
      requestId: "req-1",
    });
    expect(rpc).toHaveBeenCalledWith(
      "invoice_payment_milestone",
      expect.objectContaining({
        p_expected_lock_version: 3,
        p_idempotency_key: "idem-abc12345",
      }),
    );
  });

  it("forwards mark-paid metadata unchanged for DB-side sensitive screening", async () => {
    const rpc = okRpc({ id: "m1", status: "paid" });
    await markPaymentMilestonePaid({
      supabase: { rpc } as never,
      organizationId: "org-1",
      milestoneId: "m1",
      expectedLockVersion: 4,
      input: { paymentMethod: "cash", metadata: { note: "現金" } },
      idempotencyKey: "idem-abc12345",
      requestId: "req-1",
    });
    expect(rpc).toHaveBeenCalledWith(
      "mark_payment_milestone_paid",
      expect.objectContaining({ p_payment_method: "cash", p_metadata: { note: "現金" } }),
    );
  });

  it("maps a sensitive-field rejection (RENSF) to a 422", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: null, error: { code: "RENSF", message: "PAYMENT_SENSITIVE_FIELD_REJECTED" } });
    await expect(
      markPaymentMilestonePaid({
        supabase: { rpc } as never,
        organizationId: "org-1",
        milestoneId: "m1",
        expectedLockVersion: 4,
        input: { metadata: { cardNumber: "4111111111111111" } },
        idempotencyKey: "idem-abc12345",
        requestId: "req-1",
      }),
    ).rejects.toMatchObject({ status: 422, code: "SENSITIVE_FIELD_REJECTED" });
  });

  it("maps STALE_VERSION to a 412", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: null, error: { message: "STALE_VERSION" } });
    await expect(
      waivePaymentMilestone({
        supabase: { rpc } as never,
        organizationId: "org-1",
        milestoneId: "m1",
        expectedLockVersion: 1,
        input: { reason: "客戶取消" },
        idempotencyKey: "idem-abc12345",
        requestId: "req-1",
      }),
    ).rejects.toMatchObject({ status: 412 });
  });

  it("reverse requires only owner/admin at the DB layer and forwards reason", async () => {
    const rpc = okRpc({ id: "m1", status: "invoiced" });
    await reversePaymentMilestone({
      supabase: { rpc } as never,
      organizationId: "org-1",
      milestoneId: "m1",
      expectedLockVersion: 5,
      input: { reason: "誤記" },
      idempotencyKey: "idem-abc12345",
      requestId: "req-1",
    });
    expect(rpc).toHaveBeenCalledWith(
      "reverse_payment_milestone",
      expect.objectContaining({ p_reason: "誤記" }),
    );
  });

  it("cancel forwards reason", async () => {
    const rpc = okRpc({ id: "m1", status: "cancelled" });
    await cancelPaymentMilestone({
      supabase: { rpc } as never,
      organizationId: "org-1",
      milestoneId: "m1",
      expectedLockVersion: 1,
      input: { reason: "重複" },
      idempotencyKey: "idem-abc12345",
      requestId: "req-1",
    });
    expect(rpc).toHaveBeenCalledWith(
      "cancel_payment_milestone",
      expect.objectContaining({ p_reason: "重複" }),
    );
  });

  it("list forwards filters and returns the envelope with includeAmounts", async () => {
    const rpc = okRpc({ milestones: [], includeAmounts: true });
    const result = await listPaymentMilestones({
      supabase: { rpc } as never,
      organizationId: "org-1",
      status: "overdue",
      limit: 25,
    });
    expect(result).toEqual({ milestones: [], includeAmounts: true });
  });

  it("detail returns the milestone json", async () => {
    const rpc = okRpc({ id: "m1" });
    const result = await getPaymentMilestoneDetail({
      supabase: { rpc } as never,
      organizationId: "org-1",
      milestoneId: "m1",
    });
    expect(result).toEqual({ id: "m1" });
  });

  it("markPaymentsOverdue returns the count", async () => {
    const rpc = okRpc({ markedOverdue: 2 });
    const result = await markPaymentsOverdue({ supabase: { rpc } as never });
    expect(result).toEqual({ markedOverdue: 2 });
  });

  it("throws a 500 problem when the RPC returns a non-object", async () => {
    const rpc = okRpc(null);
    await expect(
      getPaymentMilestoneDetail({
        supabase: { rpc } as never,
        organizationId: "org-1",
        milestoneId: "m1",
      }),
    ).rejects.toBeInstanceOf(ApiProblem);
  });
});
