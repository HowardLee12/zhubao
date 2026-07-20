import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const pilotApi = vi.hoisted(() => ({ fetchPilotSession: vi.fn() }));
const api = vi.hoisted(() => ({
  fetchPaymentMilestones: vi.fn(),
  invoicePaymentMilestone: vi.fn(),
  markPaymentMilestonePaid: vi.fn(),
  waivePaymentMilestone: vi.fn(),
  reversePaymentMilestone: vi.fn(),
}));

vi.mock("./api", () => ({ fetchPilotSession: pilotApi.fetchPilotSession }));
vi.mock("./operations-api", () => api);

import { PaymentsView } from "./payments-view";

const ORG = "20000000-0000-4000-8000-000000000001";

function session(role: string) {
  return {
    user: { id: "u1", email: "o@t.test", displayName: "O" },
    memberships: [{ id: "m1", organizationId: ORG, displayName: "O", role, status: "active" }],
  };
}

function milestone(overrides: Record<string, unknown> = {}) {
  return {
    id: "87000000-0000-4000-8000-000000000001",
    organizationId: ORG,
    projectId: "81000000-0000-4000-8000-000000000001",
    quoteVersionId: null,
    changeOrderId: null,
    name: "第一期款",
    sequenceNo: 1,
    status: "pending",
    dueOn: "2026-10-01",
    invoicedAt: null,
    paidAt: null,
    waivedAt: null,
    cancelledAt: null,
    paymentMethod: null,
    externalReference: null,
    notes: null,
    lockVersion: 1,
    createdAt: "2026-01-01T00:00:00+00:00",
    updatedAt: "2026-01-01T00:00:00+00:00",
    timezone: "Asia/Taipei",
    amountMinor: 2_500_000,
    currency: "TWD",
    ...overrides,
  };
}

function list(milestones: Array<Record<string, unknown>>, includeAmounts = true) {
  return { milestones, includeAmounts };
}

beforeEach(() => {
  vi.clearAllMocks();
  pilotApi.fetchPilotSession.mockResolvedValue(session("owner"));
  api.fetchPaymentMilestones.mockResolvedValue(list([milestone()]));
  api.invoicePaymentMilestone.mockResolvedValue(milestone({ status: "invoiced", lockVersion: 2 }));
  api.markPaymentMilestonePaid.mockResolvedValue(milestone({ status: "paid", lockVersion: 3 }));
  api.waivePaymentMilestone.mockResolvedValue(milestone({ status: "waived", lockVersion: 2 }));
  api.reversePaymentMilestone.mockResolvedValue(milestone({ status: "invoiced", lockVersion: 4 }));
});

describe("PaymentsView", () => {
  it("shows a pending milestone with its amount and lets a manager invoice it", async () => {
    render(<PaymentsView />);

    await screen.findByText("第一期款");
    expect(screen.getByText("$2,500,000")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "建立請款" }));
    await waitFor(() => expect(api.invoicePaymentMilestone).toHaveBeenCalledTimes(1));
    expect(api.invoicePaymentMilestone).toHaveBeenCalledWith(
      ORG,
      milestone().id,
      1,
      undefined,
    );
  });

  it("marks an invoiced milestone paid via the record-payment action", async () => {
    api.fetchPaymentMilestones.mockResolvedValue(
      list([milestone({ status: "invoiced", lockVersion: 2 })]),
    );
    render(<PaymentsView />);

    // Switch to the 已請款 tab where invoiced milestones live.
    await screen.findByRole("tab", { name: /已請款/ });
    await userEvent.click(screen.getByRole("tab", { name: /已請款/ }));

    await userEvent.click(await screen.findByRole("button", { name: "記錄收款" }));
    await waitFor(() => expect(api.markPaymentMilestonePaid).toHaveBeenCalledTimes(1));
    expect(api.markPaymentMilestonePaid).toHaveBeenCalledWith(ORG, milestone().id, 2, {});
  });

  it("shows an honest not-supported empty state on the 部分付款 tab", async () => {
    render(<PaymentsView />);
    await screen.findByRole("tab", { name: /部分付款/ });
    await userEvent.click(screen.getByRole("tab", { name: /部分付款/ }));
    expect(await screen.findByText(/尚未支援分批/)).toBeInTheDocument();
  });

  it("surfaces days overdue on an overdue milestone (not auto bad-debt)", async () => {
    api.fetchPaymentMilestones.mockResolvedValue(
      list([milestone({ status: "overdue", dueOn: "2026-01-01", lockVersion: 2 })]),
    );
    render(<PaymentsView />);
    await screen.findByRole("tab", { name: /逾期/ });
    await userEvent.click(screen.getByRole("tab", { name: /逾期/ }));
    expect(await screen.findByText(/已逾期 \d+ 天/)).toBeInTheDocument();
  });

  it("blocks a technician from the payments surface (permission state)", async () => {
    pilotApi.fetchPilotSession.mockResolvedValue(session("technician"));
    render(<PaymentsView />);
    await screen.findByText("你沒有檢視權限");
    expect(api.fetchPaymentMilestones).not.toHaveBeenCalled();
  });

  it("shows an error state when loading fails and can retry", async () => {
    api.fetchPaymentMilestones.mockRejectedValueOnce(new Error("boom"));
    render(<PaymentsView />);
    await screen.findByText("收款資料讀不到");
  });

  it("shows an empty state when there are no milestones", async () => {
    api.fetchPaymentMilestones.mockResolvedValue(list([]));
    render(<PaymentsView />);
    await screen.findByRole("tab", { name: /待請款/ });
    expect(await screen.findByText(/目前沒有待請款款項/)).toBeInTheDocument();
  });

  it("errors when there is no active membership", async () => {
    pilotApi.fetchPilotSession.mockResolvedValue({
      user: { id: "u1", email: "o@t.test", displayName: "O" },
      memberships: [],
    });
    render(<PaymentsView />);
    await screen.findByText("收款資料讀不到");
  });

  it("does not set state after unmount (cleanup guard)", async () => {
    let resolveSession: (value: unknown) => void = () => {};
    pilotApi.fetchPilotSession.mockReturnValue(
      new Promise((resolve) => {
        resolveSession = resolve;
      }),
    );
    const view = render(<PaymentsView />);
    view.unmount();
    resolveSession(session("owner"));
    await Promise.resolve();
    await Promise.resolve();
    expect(screen.queryByText("收款款項")).toBeNull();
  });

  it("hides amounts when the DTO redacts them (includeAmounts=false)", async () => {
    api.fetchPaymentMilestones.mockResolvedValue(
      list([milestone({ amountMinor: undefined, currency: undefined })], false),
    );
    render(<PaymentsView />);
    await screen.findByText("第一期款");
    expect(screen.queryByText("$2,500,000")).toBeNull();
  });

  it("surfaces an inline error when an action fails", async () => {
    api.invoicePaymentMilestone.mockRejectedValueOnce(new Error("boom"));
    render(<PaymentsView />);
    await screen.findByText("第一期款");
    await userEvent.click(screen.getByRole("button", { name: "建立請款" }));
    expect(await screen.findByText(/boom|建立請款失敗/)).toBeInTheDocument();
  });

  it("shows a paid milestone's payment method and no overdue-days line", async () => {
    api.fetchPaymentMilestones.mockResolvedValue(
      list([milestone({ status: "paid", paymentMethod: "轉帳", lockVersion: 3 })]),
    );
    render(<PaymentsView />);
    await screen.findByRole("tab", { name: /已收款/ });
    await userEvent.click(screen.getByRole("tab", { name: /已收款/ }));
    expect(await screen.findByText("轉帳")).toBeInTheDocument();
    expect(screen.queryByText(/已逾期 \d+ 天/)).toBeNull();
  });

  it("offers reverse on a paid milestone and waive is hidden there", async () => {
    api.fetchPaymentMilestones.mockResolvedValue(
      list([milestone({ status: "paid", lockVersion: 3 })]),
    );
    render(<PaymentsView />);
    await screen.findByRole("tab", { name: /已收款/ });
    await userEvent.click(screen.getByRole("tab", { name: /已收款/ }));
    await userEvent.click(await screen.findByRole("button", { name: "沖銷收款" }));
    await waitFor(() => expect(api.reversePaymentMilestone).toHaveBeenCalledTimes(1));
  });
});
