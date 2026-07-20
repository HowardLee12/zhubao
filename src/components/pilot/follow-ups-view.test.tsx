import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const pilotApi = vi.hoisted(() => ({ fetchPilotSession: vi.fn() }));
const api = vi.hoisted(() => ({
  fetchMaintenancePlans: vi.fn(),
  prepareMaintenanceReminders: vi.fn(),
  convertMaintenancePlan: vi.fn(),
}));

import { PilotApiError } from "./api";

vi.mock("./api", async () => {
  const actual = await vi.importActual<typeof import("./api")>("./api");
  return { ...actual, fetchPilotSession: pilotApi.fetchPilotSession };
});
vi.mock("./operations-api", () => api);

import { FollowUpsView } from "./follow-ups-view";

const ORG = "20000000-0000-4000-8000-000000000001";

function session(role: string) {
  return {
    user: { id: "u1", email: "o@t.test", displayName: "O" },
    memberships: [{ id: "m1", organizationId: ORG, displayName: "O", role, status: "active" }],
  };
}

// A due plan: next_due_on within the lead window of "now" so it lands on the
// 本週到期 tab regardless of the wall clock at test time.
function plan(overrides: Record<string, unknown> = {}) {
  const soon = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
  return {
    id: "88000000-0000-4000-8000-000000000001",
    organizationId: ORG,
    customerId: "40000000-0000-4000-8000-000000000001",
    locationId: "50000000-0000-4000-8000-000000000001",
    assetId: "60000000-0000-4000-8000-000000000001",
    serviceCatalogItemId: null,
    name: "冷氣年度保養",
    cadenceMonths: 12,
    leadDays: 14,
    nextDueOn: soon,
    lastCompletedWorkOrderId: null,
    status: "active",
    autoPrepareMessage: true,
    pausedAt: null,
    completedAt: null,
    cancelledAt: null,
    lockVersion: 1,
    createdAt: "2026-01-01T00:00:00+00:00",
    updatedAt: "2026-01-01T00:00:00+00:00",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  pilotApi.fetchPilotSession.mockResolvedValue(session("owner"));
  api.fetchMaintenancePlans.mockResolvedValue([plan()]);
  api.prepareMaintenanceReminders.mockResolvedValue({ prepared: 1, skipped: 0 });
  api.convertMaintenancePlan.mockResolvedValue({
    serviceRequestId: "aa000000-0000-4000-8000-000000000001",
    requestNo: "SR-2026-0009",
    replayed: false,
  });
});

describe("FollowUpsView", () => {
  it("lists a due plan on the 本週到期 tab and prepares an approval-pending reminder", async () => {
    render(<FollowUpsView />);
    await screen.findByText("冷氣年度保養");

    await userEvent.click(screen.getByRole("button", { name: "準備回訪提醒" }));
    await waitFor(() => expect(api.prepareMaintenanceReminders).toHaveBeenCalledTimes(1));
    expect(api.prepareMaintenanceReminders).toHaveBeenCalledWith(ORG, [plan().id]);
    expect(await screen.findByText(/已準備 1 筆回訪提醒草稿/)).toBeInTheDocument();
  });

  it("converts a plan into a new revisit case with one click", async () => {
    render(<FollowUpsView />);
    await screen.findByText("冷氣年度保養");

    await userEvent.click(screen.getByRole("button", { name: "轉成新案件" }));
    await waitFor(() => expect(api.convertMaintenancePlan).toHaveBeenCalledTimes(1));
    expect(api.convertMaintenancePlan).toHaveBeenCalledWith(ORG, plan().id, 1, { subject: "回訪保養" });
    expect(await screen.findByText(/已建立新案件/)).toBeInTheDocument();
  });

  it("prompts for a forced confirm when the asset already has an open request (409)", async () => {
    api.convertMaintenancePlan.mockRejectedValueOnce(
      new PilotApiError("OPEN_REQUEST_CONFLICT", 409),
    );
    render(<FollowUpsView />);
    await screen.findByText("冷氣年度保養");

    await userEvent.click(screen.getByRole("button", { name: "轉成新案件" }));
    // The conflict surfaces a forced-confirm dialog; confirming retries with force.
    await screen.findByText(/此設備已有進行中的案件/);
    api.convertMaintenancePlan.mockResolvedValueOnce({
      serviceRequestId: "aa000000-0000-4000-8000-000000000002",
      replayed: false,
    });
    await userEvent.click(screen.getByRole("button", { name: "仍要建立新案件" }));
    await waitFor(() =>
      expect(api.convertMaintenancePlan).toHaveBeenLastCalledWith(ORG, plan().id, 1, {
        subject: "回訪保養",
        force: true,
      }),
    );
  });

  it("converts even when the response omits a request number", async () => {
    api.convertMaintenancePlan.mockResolvedValueOnce({
      serviceRequestId: "aa000000-0000-4000-8000-000000000003",
      replayed: false,
    });
    render(<FollowUpsView />);
    await screen.findByText("冷氣年度保養");
    await userEvent.click(screen.getByRole("button", { name: "轉成新案件" }));
    expect(await screen.findByText(/已建立新案件/)).toBeInTheDocument();
  });

  it("shows the 已轉單 tab for a completed plan", async () => {
    api.fetchMaintenancePlans.mockResolvedValue([
      plan({ status: "completed", completedAt: "2026-06-01T00:00:00+00:00" }),
    ]);
    render(<FollowUpsView />);
    await screen.findByRole("tab", { name: /已轉單/ });
    await userEvent.click(screen.getByRole("tab", { name: /已轉單/ }));
    expect(await screen.findByText("冷氣年度保養")).toBeInTheDocument();
  });

  it("blocks a technician (permission state)", async () => {
    pilotApi.fetchPilotSession.mockResolvedValue(session("technician"));
    render(<FollowUpsView />);
    await screen.findByText("你沒有檢視權限");
    expect(api.fetchMaintenancePlans).not.toHaveBeenCalled();
  });

  it("shows an error state on load failure", async () => {
    api.fetchMaintenancePlans.mockRejectedValueOnce(new Error("boom"));
    render(<FollowUpsView />);
    await screen.findByText("回訪資料讀不到");
  });

  it("errors when there is no active membership", async () => {
    pilotApi.fetchPilotSession.mockResolvedValue({
      user: { id: "u1", email: "o@t.test", displayName: "O" },
      memberships: [],
    });
    render(<FollowUpsView />);
    await screen.findByText("回訪資料讀不到");
  });

  it("does not set state after unmount (cleanup guard)", async () => {
    let resolveSession: (value: unknown) => void = () => {};
    pilotApi.fetchPilotSession.mockReturnValue(
      new Promise((resolve) => {
        resolveSession = resolve;
      }),
    );
    const view = render(<FollowUpsView />);
    view.unmount();
    resolveSession(session("owner"));
    await Promise.resolve();
    await Promise.resolve();
    expect(screen.queryByText("保養回訪")).toBeNull();
  });

  it("shows an empty state when there are no plans on a tab", async () => {
    api.fetchMaintenancePlans.mockResolvedValue([]);
    render(<FollowUpsView />);
    await screen.findByRole("tab", { name: /本週到期/ });
    expect(await screen.findByText(/本週沒有到期的回訪/)).toBeInTheDocument();
  });

  it("surfaces an error when preparing the reminder fails", async () => {
    api.prepareMaintenanceReminders.mockRejectedValueOnce(new Error("nope"));
    render(<FollowUpsView />);
    await screen.findByText("冷氣年度保養");
    await userEvent.click(screen.getByRole("button", { name: "準備回訪提醒" }));
    expect(await screen.findByText(/準備回訪提醒失敗|nope/)).toBeInTheDocument();
  });

  it("surfaces a non-conflict convert error without a forced dialog", async () => {
    api.convertMaintenancePlan.mockRejectedValueOnce(new PilotApiError("boom", 500));
    render(<FollowUpsView />);
    await screen.findByText("冷氣年度保養");
    await userEvent.click(screen.getByRole("button", { name: "轉成新案件" }));
    expect(await screen.findByText(/boom|轉成新案件失敗/)).toBeInTheDocument();
    expect(screen.queryByText(/此設備已有進行中的案件/)).toBeNull();
  });

  it("shows a 稍後 plan and a 已略過 (cancelled) plan on their tabs", async () => {
    const later = new Date(Date.now() + 120 * 86_400_000).toISOString().slice(0, 10);
    api.fetchMaintenancePlans.mockResolvedValue([
      plan({ id: "88000000-0000-4000-8000-0000000000aa", nextDueOn: later }),
      plan({ id: "88000000-0000-4000-8000-0000000000bb", status: "cancelled" }),
    ]);
    render(<FollowUpsView />);
    await screen.findByRole("tab", { name: /稍後/ });
    await userEvent.click(screen.getByRole("tab", { name: /稍後/ }));
    expect(await screen.findByText("冷氣年度保養")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: /已略過/ }));
    expect(await screen.findByText("冷氣年度保養")).toBeInTheDocument();
  });

  it("dismisses the forced-convert dialog when the owner backs out", async () => {
    api.convertMaintenancePlan.mockRejectedValueOnce(new PilotApiError("OPEN_REQUEST_CONFLICT", 409));
    render(<FollowUpsView />);
    await screen.findByText("冷氣年度保養");
    await userEvent.click(screen.getByRole("button", { name: "轉成新案件" }));
    await screen.findByText(/此設備已有進行中的案件/);
    await userEvent.click(screen.getByRole("button", { name: "先不要" }));
    await waitFor(() => expect(screen.queryByText(/此設備已有進行中的案件/)).toBeNull());
  });
});
