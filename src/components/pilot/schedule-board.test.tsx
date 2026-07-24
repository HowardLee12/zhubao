import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ScheduleBoard } from "./schedule-board";

const organizationId = "20000000-0000-4000-8000-000000000001";

const pilotApi = vi.hoisted(() => ({ fetchPilotSession: vi.fn() }));
const woApi = vi.hoisted(() => ({ fetchScheduleWindow: vi.fn(), listWorkOrders: vi.fn() }));

vi.mock("./api", () => ({
  fetchPilotSession: pilotApi.fetchPilotSession,
  PilotApiError: class extends Error {},
}));

vi.mock("./work-order-api", async () => {
  const actual = await vi.importActual<typeof import("./work-order-api")>("./work-order-api");
  return {
    ...actual,
    fetchScheduleWindow: woApi.fetchScheduleWindow,
    listWorkOrders: woApi.listWorkOrders,
  };
});

function member(role: string) {
  return {
    user: { id: "u", email: "x@example.test", displayName: "n" },
    memberships: [
      { id: "m", organizationId, displayName: "n", role, status: "active" },
    ],
  };
}

function item(id: string, title: string, status: string, start: string | null) {
  return {
    id,
    workOrderNo: `W-${id}`,
    title,
    status,
    priority: "normal",
    customerId: "40000000-0000-4000-8000-000000000001",
    projectId: null,
    assetId: null,
    scheduledStartAt: start,
    scheduledEndAt: start,
    completedAt: null,
    lockVersion: 1,
    createdAt: "2026-07-19T00:00:00Z",
    updatedAt: "2026-07-19T00:00:00Z",
    assigneeCount: 1,
  };
}

describe("ScheduleBoard", () => {
  afterEach(() => vi.clearAllMocks());

  it("restricts non-manager roles", async () => {
    pilotApi.fetchPilotSession.mockResolvedValue(member("technician"));
    render(<ScheduleBoard now={() => new Date("2026-08-01T00:00:00Z")} />);
    await screen.findByText("你沒有排程權限");
    expect(woApi.fetchScheduleWindow).not.toHaveBeenCalled();
  });

  it("shows scheduled work orders grouped and the honest LINE banner", async () => {
    pilotApi.fetchPilotSession.mockResolvedValue(member("dispatcher"));
    woApi.fetchScheduleWindow.mockResolvedValue([
      item("1", "已排程工單", "scheduled", "2026-08-05T01:00:00Z"),
    ]);
    woApi.listWorkOrders.mockResolvedValue({ data: [], meta: { hasMore: false, nextCursor: null } });
    render(<ScheduleBoard now={() => new Date("2026-08-01T00:00:00Z")} />);

    await screen.findByText("已排程工單");
    expect(screen.getByText(/排程與派工通知尚未自動發送/)).toBeInTheDocument();
  });

  it("lists unscheduled draft work orders in the drawer", async () => {
    pilotApi.fetchPilotSession.mockResolvedValue(member("owner"));
    woApi.fetchScheduleWindow.mockResolvedValue([]);
    woApi.listWorkOrders.mockResolvedValue({
      data: [item("9", "次臥冷氣清洗", "draft", null)],
      meta: { hasMore: false, nextCursor: null },
    });
    render(<ScheduleBoard now={() => new Date("2026-08-01T00:00:00Z")} />);

    await screen.findByText("次臥冷氣清洗");
    expect(screen.getByRole("heading", { name: "待排程工單" })).toBeInTheDocument();
    expect(screen.getByText("這兩週還沒有排程工單")).toBeInTheDocument();
  });

  it("surfaces an error state on failure", async () => {
    pilotApi.fetchPilotSession.mockRejectedValue(new Error("network"));
    render(<ScheduleBoard now={() => new Date("2026-08-01T00:00:00Z")} />);
    await screen.findByText("無法載入排程");
  });
});
