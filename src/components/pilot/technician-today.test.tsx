import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TechnicianToday } from "./technician-today";

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

function item(id: string, title: string, status: string) {
  return {
    id,
    workOrderNo: `W-${id}`,
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

const emptyPage = { data: [], meta: { hasMore: false, nextCursor: null } };

describe("TechnicianToday", () => {
  afterEach(() => vi.clearAllMocks());

  it("surfaces the next work order as the hero and requests only own assignments", async () => {
    mockSession();
    woApi.listWorkOrders.mockImplementation(async (_org: string, options: { status?: string }) =>
      options.status === "on_site" ? { ...emptyPage, data: [item("1", "下一張", "on_site")] } : emptyPage,
    );
    render(<TechnicianToday />);

    await screen.findByText("下一張");
    expect(screen.getByText("下一張工單")).toBeInTheDocument();
    for (const call of woApi.listWorkOrders.mock.calls) {
      expect(call[1].assigneeId).toBe(membershipId);
    }
  });

  it("shows an empty state when nothing is assigned", async () => {
    mockSession();
    woApi.listWorkOrders.mockResolvedValue(emptyPage);
    render(<TechnicianToday />);
    await screen.findByText("今天沒有指派給你的工單");
  });

  it("shows an error state on failure", async () => {
    mockSession();
    woApi.listWorkOrders.mockRejectedValue(new Error("network"));
    render(<TechnicianToday />);
    await screen.findByText("無法載入今日工作");
  });
});
