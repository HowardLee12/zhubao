import { describe, expect, it } from "vitest";

import type { WorkOrderDetail } from "./work-order-api";
import {
  completionBlockers,
  formatDateTime,
  formatTimeRange,
  isActiveAssignmentStatus,
  nextFieldAction,
  photoCategoryLabel,
  priorityLabel,
  resolvePhotoItemResponse,
  statusLabel,
} from "./work-order-format";

function baseDetail(overrides: Partial<WorkOrderDetail> = {}): WorkOrderDetail {
  return {
    id: "82000000-0000-4000-8000-000000000001",
    organizationId: "20000000-0000-4000-8000-000000000001",
    workOrderNo: "W-2026-0001",
    projectId: null,
    serviceRequestId: null,
    customerId: "40000000-0000-4000-8000-000000000001",
    locationId: "50000000-0000-4000-8000-000000000001",
    assetId: null,
    title: "冷氣清洗",
    description: null,
    customerNotes: null,
    technicianNotes: null,
    internalNotes: null,
    completionSummary: null,
    priority: "normal",
    status: "on_site",
    scheduledStartAt: null,
    scheduledEndAt: null,
    dispatchedAt: null,
    enRouteAt: null,
    onSiteAt: null,
    pausedAt: null,
    completedAt: null,
    cancelledAt: null,
    cancellationReason: null,
    requiresCustomerSignoff: false,
    customerSignedAt: null,
    lockVersion: 3,
    createdAt: "2026-07-19T00:00:00Z",
    updatedAt: "2026-07-19T00:00:00Z",
    assignments: [],
    checklists: [],
    photos: [],
    ...overrides,
  };
}

describe("work-order-format", () => {
  it("maps the domain status to the operating-crew projection label", () => {
    expect(statusLabel("on_site")).toBe("施工中");
    expect(statusLabel("dispatched")).toBe("已派工");
    expect(statusLabel("draft")).toBe("待排程");
  });

  it("advances the single primary field action per status", () => {
    expect(nextFieldAction("dispatched")?.action).toBe("enRoute");
    expect(nextFieldAction("en_route")?.action).toBe("arrive");
    expect(nextFieldAction("on_site")?.action).toBe("complete");
    expect(nextFieldAction("paused")?.action).toBe("resume");
    expect(nextFieldAction("completed")).toBeNull();
  });

  it("treats only active roster statuses as active", () => {
    expect(isActiveAssignmentStatus("accepted")).toBe(true);
    expect(isActiveAssignmentStatus("cancelled")).toBe(false);
    expect(isActiveAssignmentStatus("declined")).toBe(false);
  });

  it("formats a scheduled window in Asia/Taipei", () => {
    const range = formatTimeRange("2026-08-10T01:00:00Z", "2026-08-10T03:00:00Z");
    // 01:00Z == 09:00 Taipei, 03:00Z == 11:00 Taipei
    expect(range).toContain("09:00");
    expect(range).toContain("11:00");
  });

  it("handles missing and start-only windows plus invalid dates", () => {
    expect(formatTimeRange(null, null)).toBe("尚未排程");
    expect(formatTimeRange("2026-08-10T01:00:00Z", null)).toContain("09:00");
    expect(formatTimeRange("2026-08-10T01:00:00Z", "not-a-date")).toContain("09:00");
    expect(formatDateTime(null)).toBe("—");
    expect(formatDateTime("not-a-date")).toBe("—");
  });

  it("falls back to the raw value for unknown label keys", () => {
    expect(statusLabel("weird" as never)).toBe("weird");
    expect(priorityLabel("weird" as never)).toBe("weird");
    expect(photoCategoryLabel("weird" as never)).toBe("weird");
    expect(priorityLabel("urgent")).toBe("緊急");
    expect(photoCategoryLabel("before")).toBe("施工前");
  });

  it("reports every missing completion requirement when nothing is done", () => {
    const blockers = completionBlockers(baseDetail(), "");
    const codes = blockers.map((blocker) => blocker.code);
    expect(codes).toContain("beforePhoto");
    expect(codes).toContain("afterPhoto");
    expect(codes).toContain("completionSummary");
  });

  it("names the specific unanswered required checklist item", () => {
    const detail = baseDetail({
      checklists: [
        {
          id: "c1",
          name: "完工檢查",
          status: "pending",
          completedAt: null,
          completedByMembershipId: null,
          lockVersion: 1,
          items: [
            {
              id: "item-a",
              label: "確認運轉正常",
              responseType: "boolean",
              isRequired: true,
              evidenceRequired: false,
              options: null,
              response: null,
              completedAt: null,
              completedByMembershipId: null,
              sortOrder: 1,
            },
          ],
        },
      ],
    });
    const blockers = completionBlockers(detail, "已完成");
    const checklistBlocker = blockers.find((blocker) => blocker.code === "requiredChecklist");
    expect(checklistBlocker?.message).toContain("確認運轉正常");
    expect(checklistBlocker?.itemId).toBe("item-a");
  });

  it("names the asset/item still missing an after photo (J06-AC03)", () => {
    // Before photo present, after photo absent -> only the after photo blocks.
    const detail = baseDetail({
      photos: [
        {
          id: "p1",
          category: "before",
          status: "ready",
          checklistItemId: null,
          storagePath: "",
          mimeType: "image/jpeg",
          byteSize: 100,
          width: 10,
          height: 10,
          sha256: "a".repeat(64),
          caption: null,
          capturedAt: null,
          uploadedByMembershipId: null,
          readyAt: "2026-07-19T04:00:00Z",
          lockVersion: 2,
          createdAt: "2026-07-19T04:00:00Z",
        },
      ],
    });
    const blockers = completionBlockers(detail, "已完成清洗");
    const codes = blockers.map((blocker) => blocker.code);
    expect(codes).toContain("afterPhoto");
    expect(codes).not.toContain("beforePhoto");
    expect(codes).not.toContain("completionSummary");
  });

  it("clears a required photo item once a ready photo is linked to it", () => {
    // A photo-type required item is answered by capturing evidence, not by a
    // textual response. The mirror must treat a linked ready photo as the
    // answer or the completion button deadlocks forever.
    const detail = baseDetail({
      checklists: [
        {
          id: "c1",
          name: "完工檢查",
          status: "pending",
          completedAt: null,
          completedByMembershipId: null,
          lockVersion: 1,
          items: [
            {
              id: "item-photo",
              label: "施工後全景",
              responseType: "photo",
              isRequired: true,
              evidenceRequired: false,
              options: null,
              response: null,
              completedAt: null,
              completedByMembershipId: null,
              sortOrder: 1,
            },
          ],
        },
      ],
      photos: [
        {
          id: "wp1",
          category: "issue",
          status: "ready",
          checklistItemId: "item-photo",
          storagePath: "",
          mimeType: "image/jpeg",
          byteSize: 100,
          width: 10,
          height: 10,
          sha256: "a".repeat(64),
          caption: null,
          capturedAt: null,
          uploadedByMembershipId: null,
          readyAt: "2026-07-19T04:00:00Z",
          lockVersion: 2,
          createdAt: "2026-07-19T04:00:00Z",
        },
      ],
    });
    const blockers = completionBlockers(detail, "已完成");
    // The photo-required item is satisfied by its ready evidence — no
    // requiredChecklist blocker naming it should remain.
    const photoBlocker = blockers.find(
      (blocker) => blocker.code === "requiredChecklist" && blocker.itemId === "item-photo",
    );
    expect(photoBlocker).toBeUndefined();
  });

  it("still blocks a required photo item with no ready evidence", () => {
    const detail = baseDetail({
      checklists: [
        {
          id: "c1",
          name: "完工檢查",
          status: "pending",
          completedAt: null,
          completedByMembershipId: null,
          lockVersion: 1,
          items: [
            {
              id: "item-photo",
              label: "施工後全景",
              responseType: "photo",
              isRequired: true,
              evidenceRequired: false,
              options: null,
              response: null,
              completedAt: null,
              completedByMembershipId: null,
              sortOrder: 1,
            },
          ],
        },
      ],
    });
    const blockers = completionBlockers(detail, "已完成");
    const photoBlocker = blockers.find(
      (blocker) => blocker.code === "requiredChecklist" && blocker.itemId === "item-photo",
    );
    expect(photoBlocker).toBeDefined();
  });

  describe("resolvePhotoItemResponse", () => {
    const photoItemDetail = (photos: WorkOrderDetail["photos"]) =>
      baseDetail({
        checklists: [
          {
            id: "c1",
            name: "完工檢查",
            status: "pending",
            completedAt: null,
            completedByMembershipId: null,
            lockVersion: 1,
            items: [
              {
                id: "item-photo",
                label: "施工後全景",
                responseType: "photo",
                isRequired: true,
                evidenceRequired: false,
                options: null,
                response: null,
                completedAt: null,
                completedByMembershipId: null,
                sortOrder: 1,
              },
            ],
          },
        ],
        photos,
      });

    const readyEvidence = (id: string) => ({
      id,
      category: "issue" as const,
      status: "ready",
      checklistItemId: "item-photo",
      storagePath: "",
      mimeType: "image/jpeg",
      byteSize: 100,
      width: 10,
      height: 10,
      sha256: "a".repeat(64),
      caption: null,
      capturedAt: null,
      uploadedByMembershipId: null,
      readyAt: "2026-07-19T04:00:00Z",
      lockVersion: 2,
      createdAt: "2026-07-19T04:00:00Z",
    });

    it("returns the checklist id and ready photo ids for a photo item", () => {
      const resolved = resolvePhotoItemResponse(
        photoItemDetail([readyEvidence("wp1"), readyEvidence("wp2")]),
        "item-photo",
      );
      expect(resolved).toEqual({
        checklistId: "c1",
        itemId: "item-photo",
        photoIds: ["wp1", "wp2"],
      });
    });

    it("returns null when there is no ready evidence yet", () => {
      expect(resolvePhotoItemResponse(photoItemDetail([]), "item-photo")).toBeNull();
    });

    it("returns null for a null item id or an unknown item", () => {
      const detail = photoItemDetail([readyEvidence("wp1")]);
      expect(resolvePhotoItemResponse(detail, null)).toBeNull();
      expect(resolvePhotoItemResponse(detail, "no-such-item")).toBeNull();
    });

    it("returns null for a non-photo item even with a linked photo", () => {
      const detail = baseDetail({
        checklists: [
          {
            id: "c1",
            name: "完工檢查",
            status: "pending",
            completedAt: null,
            completedByMembershipId: null,
            lockVersion: 1,
            items: [
              {
                id: "item-text",
                label: "備註",
                responseType: "text",
                isRequired: false,
                evidenceRequired: false,
                options: null,
                response: null,
                completedAt: null,
                completedByMembershipId: null,
                sortOrder: 1,
              },
            ],
          },
        ],
        photos: [{ ...readyEvidence("wp1"), checklistItemId: "item-text" }],
      });
      expect(resolvePhotoItemResponse(detail, "item-text")).toBeNull();
    });
  });

  it("clears all blockers when the gate is satisfied", () => {
    const ready = (category: "before" | "after", id: string) => ({
      id,
      category,
      status: "ready" as const,
      checklistItemId: null,
      storagePath: "",
      mimeType: "image/jpeg",
      byteSize: 100,
      width: 10,
      height: 10,
      sha256: "a".repeat(64),
      caption: null,
      capturedAt: null,
      uploadedByMembershipId: null,
      readyAt: "2026-07-19T04:00:00Z",
      lockVersion: 2,
      createdAt: "2026-07-19T04:00:00Z",
    });
    const detail = baseDetail({ photos: [ready("before", "p1"), ready("after", "p2")] });
    expect(completionBlockers(detail, "清洗完成，運轉正常")).toHaveLength(0);
  });
});
