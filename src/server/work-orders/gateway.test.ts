import { describe, expect, it, vi } from "vitest";

import { preCheckWorkOrderTransition, targetStatusFor } from "./gateway";

const now = "2026-08-01T05:00:00+00:00";

describe("preCheckWorkOrderTransition", () => {
  const baseFacts = {
    activeAssignmentCount: 1,
    scheduledStartAt: "2026-08-01T01:00:00+00:00",
    scheduledEndAt: "2026-08-01T03:00:00+00:00",
    requiredChecklistComplete: true,
    requiredEvidenceComplete: true,
    hasBeforePhoto: true,
    hasAfterPhoto: true,
    completionSummary: "done",
  };

  it("allows a valid technician arrive", () => {
    const result = preCheckWorkOrderTransition({
      status: "en_route",
      action: "arrive",
      role: "technician",
      isAssigned: true,
      now,
      occurredAt: "2026-08-01T02:00:00+00:00",
      facts: baseFacts,
    });
    expect(result).toBeNull();
  });

  it("blocks an unassigned technician with a 403", () => {
    const result = preCheckWorkOrderTransition({
      status: "en_route",
      action: "arrive",
      role: "technician",
      isAssigned: false,
      now,
      occurredAt: "2026-08-01T02:00:00+00:00",
      facts: baseFacts,
    });
    expect(result?.status).toBe(403);
  });

  it("blocks completion with a missing after photo as 422 naming the gap", () => {
    const result = preCheckWorkOrderTransition({
      status: "on_site",
      action: "complete",
      role: "technician",
      isAssigned: true,
      now,
      occurredAt: "2026-08-01T04:30:00+00:00",
      facts: { ...baseFacts, hasAfterPhoto: false },
    });
    expect(result?.status).toBe(422);
    expect(result?.detail).toContain("afterPhoto");
  });

  it("blocks an illegal state transition with a 409", () => {
    const result = preCheckWorkOrderTransition({
      status: "draft",
      action: "complete",
      role: "dispatcher",
      isAssigned: false,
      now,
      occurredAt: "2026-08-01T04:30:00+00:00",
      facts: baseFacts,
    });
    expect(result?.status).toBe(409);
  });
});

describe("targetStatusFor", () => {
  it("maps actions to DB target statuses", () => {
    expect(targetStatusFor("arrive")).toBe("on_site");
    expect(targetStatusFor("dispatch")).toBe("dispatched");
    expect(targetStatusFor("reopen")).toBe("on_site");
  });
});

vi.mock("@/server/api/work-order-photos", () => ({
  computeWorkMediaActuals: vi.fn(),
  signWorkMediaReadUrl: vi.fn(),
}));

describe("resolveWorkOrderPhotoReadUrl", () => {
  it("authorizes via RPC then signs the storage path", async () => {
    const { signWorkMediaReadUrl } = await import("@/server/api/work-order-photos");
    (signWorkMediaReadUrl as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      url: "https://signed.example/photo",
      expiresAt: "2026-08-01T05:05:00+00:00",
    });
    const { resolveWorkOrderPhotoReadUrl } = await import("./gateway");
    const rpc = vi.fn().mockResolvedValue({
      data: { photoId: "p1", storagePath: "org/x/work-orders/w/p/upload" },
      error: null,
    });
    const result = await resolveWorkOrderPhotoReadUrl({
      supabase: { rpc } as never,
      organizationId: "org-1",
      photoId: "p1",
    });
    expect(rpc).toHaveBeenCalledWith("get_work_order_photo_read_url", {
      target_org: "org-1",
      target_photo: "p1",
    });
    expect(result.url).toBe("https://signed.example/photo");
  });
});
