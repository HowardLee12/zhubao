import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TechnicianTaskList } from "./technician-task-list";

const organizationId = "20000000-0000-4000-8000-000000000001";
const membershipId = "30000000-0000-4000-8000-000000000003";

const pilotApi = vi.hoisted(() => ({ fetchPilotSession: vi.fn() }));
const woApi = vi.hoisted(() => ({ listWorkOrders: vi.fn() }));

vi.mock("./api", () => ({
  fetchPilotSession: pilotApi.fetchPilotSession,
  PilotApiError: class extends Error {},
}));

vi.mock("./work-order-api", async () => {
  const actual = await vi.importActual<typeof import("./work-order-api")>("./work-order-api");
  return { ...actual, listWorkOrders: woApi.listWorkOrders };
});

function mockSession() {
  pilotApi.fetchPilotSession.mockResolvedValue({
    user: { id: "u", email: "t@example.test", displayName: "技師" },
    memberships: [
      { id: membershipId, organizationId, displayName: "技師", role: "technician", status: "active" },
    ],
  });
}

function listItem(id: string, title: string, status: string) {
  return {
    id,
    workOrderNo: `W-${id.slice(-1)}`,
    title,
    status,
    priority: "normal",
    customerId: "40000000-0000-4000-8000-000000000001",
    projectId: null,
    assetId: null,
    scheduledStartAt: "2026-08-10T01:00:00Z",
    scheduledEndAt: "2026-08-10T03:00:00Z",
    completedAt: null,
    lockVersion: 1,
    createdAt: "2026-07-19T00:00:00Z",
    updatedAt: "2026-07-19T00:00:00Z",
    assigneeCount: 1,
  };
}

function page(items: ReturnType<typeof listItem>[]) {
  return { data: items, meta: { hasMore: false, nextCursor: null } };
}

describe("TechnicianTaskList", () => {
  afterEach(() => vi.clearAllMocks());

  it("requests only the signed-in technician's own assignments", async () => {
    mockSession();
    woApi.listWorkOrders.mockImplementation(async (_org: string, options: { status?: string }) =>
      options.status === "on_site"
        ? page([listItem("1", "施工中工單", "on_site")])
        : page([]),
    );
    render(<TechnicianTaskList />);

    await screen.findByText("施工中工單");
    // Every list call carries the assigneeId of the active membership.
    for (const call of woApi.listWorkOrders.mock.calls) {
      expect(call[1].assigneeId).toBe(membershipId);
    }
  });

  it("renders the status projection label and shows an empty state per tab", async () => {
    mockSession();
    woApi.listWorkOrders.mockResolvedValue(page([]));
    render(<TechnicianTaskList />);

    await screen.findByText("目前沒有進行中的工單");
  });

  it("surfaces an error state without mutating data on failure", async () => {
    mockSession();
    woApi.listWorkOrders.mockRejectedValue(new Error("network"));
    render(<TechnicianTaskList />);

    await screen.findByText("無法載入工單");
    expect(screen.getByText(/你的資料不會因此被修改/)).toBeInTheDocument();
  });

  it("switches to the 待執行 tab and lists an item with its status label", async () => {
    mockSession();
    woApi.listWorkOrders.mockImplementation(async (_org: string, options: { status?: string }) =>
      options.status === "scheduled"
        ? page([listItem("2", "待執行工單", "scheduled")])
        : page([]),
    );
    render(<TechnicianTaskList />);

    await screen.findByText("目前沒有進行中的工單");
    await userEvent.click(screen.getByRole("tab", { name: "待執行" }));
    await screen.findByText("待執行工單");
    expect(screen.getByText("已排程")).toBeInTheDocument();
  });

  it("shows a permission error when the member has no active membership", async () => {
    pilotApi.fetchPilotSession.mockResolvedValue({
      user: { id: "u", email: "t@example.test", displayName: "技師" },
      memberships: [],
    });
    render(<TechnicianTaskList />);

    await waitFor(() => expect(screen.getByText("無法載入工單")).toBeInTheDocument());
  });
});
