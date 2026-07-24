import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DispatcherWorkOrderDetail } from "./work-order-detail";
import type { WorkOrderDetail } from "./work-order-api";

const organizationId = "20000000-0000-4000-8000-000000000001";
const workOrderId = "82000000-0000-4000-8000-000000000001";

const pilotApi = vi.hoisted(() => {
  class MockPilotApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  }
  return { fetchPilotSession: vi.fn(), PilotApiError: MockPilotApiError };
});

const woApi = vi.hoisted(() => ({
  fetchWorkOrderDetail: vi.fn(),
  scheduleWorkOrder: vi.fn(),
  forceCompleteWorkOrder: vi.fn(),
  transitionWorkOrder: vi.fn(),
}));

vi.mock("./api", () => ({
  fetchPilotSession: pilotApi.fetchPilotSession,
  PilotApiError: pilotApi.PilotApiError,
}));

vi.mock("./triage-api", () => ({ fetchOrganizationMembers: vi.fn().mockResolvedValue([]) }));

vi.mock("./work-order-api", async () => {
  const actual = await vi.importActual<typeof import("./work-order-api")>("./work-order-api");
  return {
    ...actual,
    fetchWorkOrderDetail: woApi.fetchWorkOrderDetail,
    scheduleWorkOrder: woApi.scheduleWorkOrder,
    forceCompleteWorkOrder: woApi.forceCompleteWorkOrder,
    transitionWorkOrder: woApi.transitionWorkOrder,
    PilotApiError: pilotApi.PilotApiError,
  };
});

function session(role: string) {
  return {
    user: { id: "u", email: "x@example.test", displayName: "n" },
    memberships: [{ id: "m", organizationId, displayName: "n", role, status: "active" }],
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
    title: "冷氣清洗",
    description: null,
    customerNotes: null,
    technicianNotes: null,
    internalNotes: "成本備註",
    completionSummary: null,
    priority: "normal",
    status: "draft",
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
    lockVersion: 1,
    createdAt: "2026-07-19T00:00:00Z",
    updatedAt: "2026-07-19T00:00:00Z",
    assignments: [],
    checklists: [],
    photos: [],
    ...overrides,
  };
}

describe("DispatcherWorkOrderDetail", () => {
  afterEach(() => vi.clearAllMocks());

  it("restricts technicians from the dispatcher workspace", async () => {
    pilotApi.fetchPilotSession.mockResolvedValue(session("technician"));
    render(<DispatcherWorkOrderDetail workOrderId={workOrderId} />);
    await screen.findByText("你沒有派工權限");
    expect(woApi.fetchWorkOrderDetail).not.toHaveBeenCalled();
  });

  it("offers schedule for a draft and dispatch for a scheduled work order", async () => {
    pilotApi.fetchPilotSession.mockResolvedValue(session("dispatcher"));
    woApi.fetchWorkOrderDetail.mockResolvedValueOnce(detail());
    const { rerender } = render(<DispatcherWorkOrderDetail workOrderId={workOrderId} />);
    await screen.findByRole("heading", { name: "冷氣清洗" });
    expect(screen.getByRole("button", { name: "排程並指派" })).toBeInTheDocument();

    woApi.fetchWorkOrderDetail.mockResolvedValueOnce(detail({ status: "scheduled", lockVersion: 2 }));
    rerender(<DispatcherWorkOrderDetail workOrderId={`${workOrderId}?v=2`} />);
    await screen.findByRole("button", { name: "派工給師傅" });
  });

  it("dispatches and shows the confirmation notice (dispatch enqueues no LINE notice)", async () => {
    pilotApi.fetchPilotSession.mockResolvedValue(session("dispatcher"));
    woApi.fetchWorkOrderDetail
      .mockResolvedValueOnce(detail({ status: "scheduled", lockVersion: 2 }))
      .mockResolvedValueOnce(detail({ status: "dispatched", lockVersion: 3 }));
    woApi.transitionWorkOrder.mockResolvedValue({
      data: { status: "dispatched", lockVersion: 3 },
      notification: null,
    });
    render(<DispatcherWorkOrderDetail workOrderId={workOrderId} />);

    await screen.findByRole("button", { name: "派工給師傅" });
    await userEvent.click(screen.getByRole("button", { name: "派工給師傅" }));
    await waitFor(() => expect(woApi.transitionWorkOrder).toHaveBeenCalledTimes(1));
    expect(woApi.transitionWorkOrder.mock.calls[0][3]).toBe("dispatch");
    // The confirmation notice appears; a non-completing transition adds no LINE line.
    await screen.findByText("已派工。");
    expect(screen.queryByText(/已排入 LINE 通知/)).toBeNull();
  });

  it("offers force-complete only to owner/admin on an on-site work order", async () => {
    pilotApi.fetchPilotSession.mockResolvedValue(session("owner"));
    woApi.fetchWorkOrderDetail.mockResolvedValue(detail({ status: "on_site", lockVersion: 4 }));
    render(<DispatcherWorkOrderDetail workOrderId={workOrderId} />);

    await screen.findByRole("button", { name: "例外完工（非客戶簽認）" });
  });

  it("does not offer force-complete to a plain dispatcher", async () => {
    pilotApi.fetchPilotSession.mockResolvedValue(session("dispatcher"));
    woApi.fetchWorkOrderDetail.mockResolvedValue(detail({ status: "on_site", lockVersion: 4 }));
    render(<DispatcherWorkOrderDetail workOrderId={workOrderId} />);

    await screen.findByRole("heading", { name: "冷氣清洗" });
    expect(
      screen.queryByRole("button", { name: "例外完工（非客戶簽認）" }),
    ).not.toBeInTheDocument();
  });

  it("shows an error state when the detail cannot be loaded", async () => {
    pilotApi.fetchPilotSession.mockResolvedValue(session("dispatcher"));
    woApi.fetchWorkOrderDetail.mockRejectedValue(new Error("network"));
    render(<DispatcherWorkOrderDetail workOrderId={workOrderId} />);
    await screen.findByText("無法載入工單");
  });

  it("reconciles to server truth when dispatch hits a 412 stale lock", async () => {
    pilotApi.fetchPilotSession.mockResolvedValue(session("dispatcher"));
    woApi.fetchWorkOrderDetail
      .mockResolvedValueOnce(detail({ status: "scheduled", lockVersion: 2 }))
      .mockResolvedValueOnce(detail({ status: "dispatched", lockVersion: 3 }));
    woApi.transitionWorkOrder.mockRejectedValue(new pilotApi.PilotApiError("stale", 412));
    render(<DispatcherWorkOrderDetail workOrderId={workOrderId} />);

    await userEvent.click(await screen.findByRole("button", { name: "派工給師傅" }));
    await screen.findByText(/畫面已同步/);
  });

  it("surfaces a generic error when dispatch fails for another reason", async () => {
    pilotApi.fetchPilotSession.mockResolvedValue(session("dispatcher"));
    woApi.fetchWorkOrderDetail.mockResolvedValue(detail({ status: "scheduled", lockVersion: 2 }));
    woApi.transitionWorkOrder.mockRejectedValue(new Error("boom"));
    render(<DispatcherWorkOrderDetail workOrderId={workOrderId} />);

    await userEvent.click(await screen.findByRole("button", { name: "派工給師傅" }));
    await screen.findByText("boom");
  });

  it("renders the assigned roster and internal cost note for a manager", async () => {
    pilotApi.fetchPilotSession.mockResolvedValue(session("owner"));
    woApi.fetchWorkOrderDetail.mockResolvedValue(
      detail({
        status: "scheduled",
        internalNotes: "成本備註",
        assignments: [
          {
            id: "a1",
            membershipId: "m1",
            memberName: "師傅甲",
            duty: "lead",
            status: "assigned",
            assignedAt: null,
            acceptedAt: null,
            declinedAt: null,
            checkedInAt: null,
            completedAt: null,
            cancelledAt: null,
            declineReason: null,
            lockVersion: 1,
          },
        ],
      }),
    );
    render(<DispatcherWorkOrderDetail workOrderId={workOrderId} />);

    await screen.findByText("師傅甲");
    expect(screen.getByText(/成本備註/)).toBeInTheDocument();
    expect(screen.getByText("主責")).toBeInTheDocument();
  });

  it("force-completes and keeps it distinct from a customer sign-off", async () => {
    pilotApi.fetchPilotSession.mockResolvedValue(session("owner"));
    woApi.fetchWorkOrderDetail
      .mockResolvedValueOnce(detail({ status: "on_site", lockVersion: 4 }))
      .mockResolvedValueOnce(detail({ status: "completed", lockVersion: 5, customerSignedAt: null }));
    woApi.forceCompleteWorkOrder.mockResolvedValue({
      data: detail({ status: "completed", customerSignedAt: null }),
      notification: { status: "queued", channel: "line" },
    });
    render(<DispatcherWorkOrderDetail workOrderId={workOrderId} />);

    await userEvent.click(await screen.findByRole("button", { name: "例外完工（非客戶簽認）" }));
    await userEvent.type(screen.getByPlaceholderText(/客戶臨時外出/), "客戶不在場");
    await userEvent.type(screen.getByPlaceholderText(/簡述實際完成/), "已完成");
    await userEvent.click(screen.getByRole("button", { name: "確認例外完工" }));

    await waitFor(() => expect(woApi.forceCompleteWorkOrder).toHaveBeenCalledTimes(1));
    await screen.findByText(/已例外完工（非客戶簽認）/);
  });
});
