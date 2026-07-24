import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TechnicianTaskDetail } from "./technician-task-detail";
import type { WorkOrderDetail } from "./work-order-api";

const organizationId = "20000000-0000-4000-8000-000000000001";
const workOrderId = "82000000-0000-4000-8000-000000000001";

const pilotApi = vi.hoisted(() => {
  class MockPilotApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.name = "PilotApiError";
      this.status = status;
    }
  }
  return {
    fetchPilotSession: vi.fn(),
    PilotApiError: MockPilotApiError,
  };
});

const woApi = vi.hoisted(() => ({
  fetchWorkOrderDetail: vi.fn(),
  transitionWorkOrder: vi.fn(),
  respondToChecklistItem: vi.fn(),
  captureWorkOrderPhoto: vi.fn(),
}));

vi.mock("./api", () => ({
  fetchPilotSession: pilotApi.fetchPilotSession,
  PilotApiError: pilotApi.PilotApiError,
  createIdempotencyKey: () => "idem",
  sha256File: async () => "a".repeat(64),
}));

vi.mock("./work-order-api", async () => {
  const actual = await vi.importActual<typeof import("./work-order-api")>("./work-order-api");
  return {
    ...actual,
    fetchWorkOrderDetail: woApi.fetchWorkOrderDetail,
    transitionWorkOrder: woApi.transitionWorkOrder,
    respondToChecklistItem: woApi.respondToChecklistItem,
    captureWorkOrderPhoto: woApi.captureWorkOrderPhoto,
    PilotApiError: pilotApi.PilotApiError,
  };
});

function readyPhoto(category: "before" | "after", id: string) {
  return {
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
    lockVersion: 1,
    createdAt: "2026-07-19T04:00:00Z",
  };
}

function detail(overrides: Partial<WorkOrderDetail> = {}): WorkOrderDetail {
  return {
    id: workOrderId,
    organizationId,
    workOrderNo: "W-2026-0001",
    projectId: null,
    serviceRequestId: null,
    customerId: "40000000-0000-4000-8000-000000000001",
    locationId: "50000000-0000-4000-8000-000000000001",
    assetId: null,
    title: "主臥冷氣清洗",
    description: "兩台分離式冷氣",
    customerNotes: null,
    technicianNotes: null,
    internalNotes: null,
    completionSummary: null,
    priority: "normal",
    status: "on_site",
    scheduledStartAt: "2026-08-10T01:00:00Z",
    scheduledEndAt: "2026-08-10T03:00:00Z",
    dispatchedAt: null,
    enRouteAt: null,
    onSiteAt: "2026-08-10T01:10:00Z",
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

function mockSession() {
  pilotApi.fetchPilotSession.mockResolvedValue({
    user: { id: "u", email: "t@example.test", displayName: "技師" },
    memberships: [
      {
        id: "30000000-0000-4000-8000-000000000003",
        organizationId,
        displayName: "技師",
        role: "technician",
        status: "active",
      },
    ],
  });
}

describe("TechnicianTaskDetail", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders the work order with its status projection label", async () => {
    mockSession();
    woApi.fetchWorkOrderDetail.mockResolvedValue(detail());
    render(<TechnicianTaskDetail workOrderId={workOrderId} />);

    await screen.findByText("主臥冷氣清洗");
    expect(screen.getByText("施工中")).toBeInTheDocument();
    expect(screen.getByText("W-2026-0001")).toBeInTheDocument();
  });

  it("blocks completion and NAMES the missing after photo (J06-AC03)", async () => {
    mockSession();
    // before photo present, after photo absent, summary present -> only after blocks.
    woApi.fetchWorkOrderDetail.mockResolvedValue(
      detail({ photos: [readyPhoto("before", "p1")], completionSummary: "已完成" }),
    );
    render(<TechnicianTaskDetail workOrderId={workOrderId} />);

    await screen.findByText("主臥冷氣清洗");
    // fill summary so only the after-photo blocks
    const summary = screen.getByPlaceholderText(/已完成兩台冷氣清洗/);
    await userEvent.type(summary, "清洗完成，運轉正常");

    await userEvent.click(screen.getByRole("button", { name: "完工回報" }));

    await screen.findByText("尚未達成完工條件");
    expect(screen.getByText(/缺少施工後照片/)).toBeInTheDocument();
    // A satisfied requirement is NOT listed.
    expect(screen.queryByText(/缺少施工前照片/)).not.toBeInTheDocument();
    // The transition was never attempted — the DB gate is not even reached.
    expect(woApi.transitionWorkOrder).not.toHaveBeenCalled();
  });

  it("completes when the gate is satisfied, sending the summary", async () => {
    mockSession();
    const ready = detail({
      photos: [readyPhoto("before", "p1"), readyPhoto("after", "p2")],
    });
    woApi.fetchWorkOrderDetail
      .mockResolvedValueOnce(ready)
      .mockResolvedValueOnce({ ...ready, status: "completed" });
    woApi.transitionWorkOrder.mockResolvedValue({
      data: { status: "completed", lockVersion: 4 },
      notification: { status: "not_sent", reason: "x" },
    });
    render(<TechnicianTaskDetail workOrderId={workOrderId} />);

    await screen.findByText("主臥冷氣清洗");
    const summary = screen.getByPlaceholderText(/已完成兩台冷氣清洗/);
    await userEvent.type(summary, "清洗完成，運轉正常");
    await userEvent.click(screen.getByRole("button", { name: "完工回報" }));

    await waitFor(() => expect(woApi.transitionWorkOrder).toHaveBeenCalledTimes(1));
    const [, , lockVersion, action, options] = woApi.transitionWorkOrder.mock.calls[0];
    expect(lockVersion).toBe(3);
    expect(action).toBe("complete");
    expect(options.completionSummary).toBe("清洗完成，運轉正常");
  });

  it("reverts to server truth on a 412 stale lock instead of faking success", async () => {
    mockSession();
    const dispatched = detail({ status: "dispatched", assignments: [] });
    woApi.fetchWorkOrderDetail
      .mockResolvedValueOnce(dispatched)
      // refresh after the 412 returns the true current status
      .mockResolvedValueOnce({ ...dispatched, status: "en_route", lockVersion: 4 });
    woApi.transitionWorkOrder.mockRejectedValue(new pilotApi.PilotApiError("stale", 412));
    render(<TechnicianTaskDetail workOrderId={workOrderId} />);

    await screen.findByText("主臥冷氣清洗");
    await userEvent.click(screen.getByRole("button", { name: "出發前往" }));

    await screen.findByText(/畫面已同步/);
    // Reconciled to the server's real state (en_route -> next action is 抵達現場).
    await screen.findByRole("button", { name: "抵達現場" });
  });

  it("shows the enRoute primary action for a dispatched work order", async () => {
    mockSession();
    woApi.fetchWorkOrderDetail.mockResolvedValue(detail({ status: "dispatched" }));
    render(<TechnicianTaskDetail workOrderId={workOrderId} />);

    await screen.findByText("主臥冷氣清洗");
    expect(screen.getByRole("button", { name: "出發前往" })).toBeInTheDocument();
  });

  it("offers a pause secondary action while on site", async () => {
    mockSession();
    woApi.fetchWorkOrderDetail
      .mockResolvedValueOnce(detail({ status: "on_site" }))
      .mockResolvedValueOnce(detail({ status: "paused", lockVersion: 4 }));
    woApi.transitionWorkOrder.mockResolvedValue({
      data: { status: "paused", lockVersion: 4 },
      notification: { status: "not_sent", reason: "x" },
    });
    render(<TechnicianTaskDetail workOrderId={workOrderId} />);

    await screen.findByText("主臥冷氣清洗");
    await userEvent.click(screen.getByRole("button", { name: "暫停" }));
    await waitFor(() => expect(woApi.transitionWorkOrder).toHaveBeenCalledTimes(1));
    expect(woApi.transitionWorkOrder.mock.calls[0][3]).toBe("pause");
  });

  it("answers a required boolean checklist item", async () => {
    mockSession();
    const withChecklist = detail({
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
    woApi.fetchWorkOrderDetail.mockResolvedValue(withChecklist);
    woApi.respondToChecklistItem.mockResolvedValue({
      id: "item-a",
      workOrderId,
      response: true,
      lockVersion: 4,
    });
    render(<TechnicianTaskDetail workOrderId={workOrderId} />);

    await screen.findByText("確認運轉正常");
    await userEvent.click(screen.getByRole("button", { name: /^是$/ }));
    await waitFor(() => expect(woApi.respondToChecklistItem).toHaveBeenCalledTimes(1));
    expect(woApi.respondToChecklistItem.mock.calls[0][4]).toBe(true);
  });

  it("answers a required photo checklist item by responding with the ready photo ids", async () => {
    mockSession();
    const photoItem = {
      id: "item-photo",
      label: "施工後全景",
      responseType: "photo" as const,
      isRequired: true,
      evidenceRequired: false,
      options: null,
      response: null,
      completedAt: null,
      completedByMembershipId: null,
      sortOrder: 1,
    };
    const withPhotoItem = detail({
      checklists: [
        {
          id: "c1",
          name: "完工檢查",
          status: "pending",
          completedAt: null,
          completedByMembershipId: null,
          lockVersion: 1,
          items: [photoItem],
        },
      ],
    });
    // After capture the refresh returns the work order with a ready photo linked
    // to the checklist item so the respond call can be built from server truth.
    const afterCapture = detail({
      checklists: withPhotoItem.checklists,
      photos: [
        {
          ...readyPhoto("issue" as never, "wp1"),
          checklistItemId: "item-photo",
        },
      ],
    });
    woApi.fetchWorkOrderDetail
      .mockResolvedValueOnce(withPhotoItem)
      .mockResolvedValueOnce(afterCapture)
      .mockResolvedValue(afterCapture);
    woApi.captureWorkOrderPhoto.mockResolvedValue({ photoId: "wp1", sha256: "a".repeat(64) });
    woApi.respondToChecklistItem.mockResolvedValue({
      id: "item-photo",
      workOrderId,
      response: ["wp1"],
      lockVersion: 4,
    });
    render(<TechnicianTaskDetail workOrderId={workOrderId} />);

    await screen.findByText("施工後全景");
    const file = new File([new Uint8Array([1, 2, 3])], "after.jpg", { type: "image/jpeg" });
    const itemInput = screen.getByLabelText(/上傳「施工後全景」照片/) as HTMLInputElement;
    await userEvent.upload(itemInput, file);

    await waitFor(() => expect(woApi.respondToChecklistItem).toHaveBeenCalledTimes(1));
    // The photo-type item's response must be the JSON array of ready photo ids.
    const respondArgs = woApi.respondToChecklistItem.mock.calls[0];
    expect(respondArgs[2]).toBe("item-photo");
    expect(respondArgs[4]).toEqual(["wp1"]);
  });

  it("surfaces a photo upload failure without faking success", async () => {
    mockSession();
    woApi.fetchWorkOrderDetail.mockResolvedValue(detail({ status: "on_site" }));
    woApi.captureWorkOrderPhoto.mockRejectedValue(new Error("上傳失敗"));
    render(<TechnicianTaskDetail workOrderId={workOrderId} />);

    await screen.findByText("主臥冷氣清洗");
    const file = new File([new Uint8Array([1, 2, 3])], "before.jpg", { type: "image/jpeg" });
    const beforeInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(beforeInput, file);
    await screen.findByText("上傳失敗");
  });

  it("shows the completed terminal state and honest notification", async () => {
    mockSession();
    woApi.fetchWorkOrderDetail.mockResolvedValue(detail({ status: "completed" }));
    render(<TechnicianTaskDetail workOrderId={workOrderId} />);

    await screen.findByText("主臥冷氣清洗");
    expect(screen.getByText(/此工單已完工/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "完工回報" })).not.toBeInTheDocument();
  });

  it("shows a not-found style error when the detail load rejects", async () => {
    mockSession();
    woApi.fetchWorkOrderDetail.mockRejectedValue(new Error("not assigned"));
    render(<TechnicianTaskDetail workOrderId={workOrderId} />);
    await screen.findByText("無法載入工單");
  });
});
