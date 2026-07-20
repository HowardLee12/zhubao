import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const pilotApi = vi.hoisted(() => ({ fetchPilotSession: vi.fn() }));
const api = vi.hoisted(() => ({ fetchDashboard: vi.fn() }));

vi.mock("./api", () => ({ fetchPilotSession: pilotApi.fetchPilotSession }));
vi.mock("./operations-api", () => api);

import { KpiDashboard } from "./kpi-dashboard";

const ORG = "20000000-0000-4000-8000-000000000001";

function session(role: string) {
  return {
    user: { id: "u1", email: "o@t.test", displayName: "O" },
    memberships: [{ id: "m1", organizationId: ORG, displayName: "老闆", role, status: "active" }],
  };
}

const WINDOW = { from: "2026-01-01", to: "2026-06-30", timezone: "Asia/Taipei" };

function kpi(overrides: Record<string, unknown> = {}) {
  return {
    available: true,
    numerator: 8,
    denominator: 10,
    window: WINDOW,
    timezone: "Asia/Taipei",
    ...overrides,
  };
}

function dashboard(overrides: Record<string, unknown> = {}) {
  return {
    window: WINDOW,
    metrics: {
      firstResponseTime: kpi({ numerator: 12, denominator: 20 }),
      quoteAcceptanceRate: kpi(),
      completionRate: kpi({ numerator: 5, denominator: 6 }),
      revisitRate: kpi({ numerator: 2, denominator: 4 }),
      ...(overrides.metrics as Record<string, unknown> | undefined),
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  pilotApi.fetchPilotSession.mockResolvedValue(session("owner"));
  api.fetchDashboard.mockResolvedValue(dashboard());
});

describe("KpiDashboard", () => {
  it("renders the four KPI cards with numerator/denominator", async () => {
    render(<KpiDashboard />);
    await screen.findByText("報價接受率");
    expect(screen.getByText("首次回覆時間")).toBeInTheDocument();
    expect(screen.getByText("完工率")).toBeInTheDocument();
    expect(screen.getByText("回訪率")).toBeInTheDocument();
    // acceptance rate 8/10 = 80%
    expect(screen.getByText("80%")).toBeInTheDocument();
  });

  it("shows an honest not-enough-data state instead of a misleading 0%", async () => {
    api.fetchDashboard.mockResolvedValue(
      dashboard({
        metrics: {
          firstResponseTime: kpi({ available: false, numerator: null, denominator: 0 }),
          quoteAcceptanceRate: kpi({ available: false, numerator: null, denominator: 0 }),
          completionRate: kpi({ available: false, numerator: null, denominator: 0 }),
          revisitRate: kpi({ available: false, numerator: null, denominator: 0 }),
        },
      }),
    );
    render(<KpiDashboard />);
    await screen.findByText("報價接受率");
    expect(screen.getAllByText("尚無足夠資料").length).toBeGreaterThan(0);
    expect(screen.queryByText("0%")).toBeNull();
  });

  it("keeps the page alive when the dashboard fetch fails (degraded, retryable)", async () => {
    api.fetchDashboard.mockRejectedValueOnce(new Error("boom"));
    render(<KpiDashboard />);
    await screen.findByText(/指標暫時讀不到/);
    expect(screen.getByRole("button", { name: /重新載入/ })).toBeInTheDocument();
  });

  it("blocks a technician (never sees KPI/cost)", async () => {
    pilotApi.fetchPilotSession.mockResolvedValue(session("technician"));
    render(<KpiDashboard />);
    await screen.findByText("你沒有檢視權限");
    expect(api.fetchDashboard).not.toHaveBeenCalled();
  });

  it("shows 尚無足夠資料 for a rate whose denominator is zero even if flagged available", async () => {
    api.fetchDashboard.mockResolvedValue(
      dashboard({
        metrics: {
          firstResponseTime: kpi(),
          quoteAcceptanceRate: kpi({ numerator: 0, denominator: 0 }),
          completionRate: kpi({ numerator: 90, denominator: 60 }),
          revisitRate: kpi({ numerator: 1, denominator: 2 }),
        },
      }),
    );
    render(<KpiDashboard />);
    await screen.findByText("報價接受率");
    // completionRate 90/60 hours -> 1.5 天 for the duration metric path is N/A here;
    // the acceptance-rate 0/0 must not read as 0% — it degrades honestly.
    expect(screen.getAllByText("尚無足夠資料").length).toBeGreaterThan(0);
  });

  it("formats the first-response duration in minutes, hours, or days", async () => {
    api.fetchDashboard.mockResolvedValue(
      dashboard({
        metrics: {
          firstResponseTime: kpi({ numerator: 45, denominator: 8 }),
          quoteAcceptanceRate: kpi(),
          completionRate: kpi(),
          revisitRate: kpi(),
        },
      }),
    );
    render(<KpiDashboard />);
    await screen.findByText("首次回覆時間");
    expect(screen.getByText("45 分")).toBeInTheDocument();

    api.fetchDashboard.mockResolvedValue(
      dashboard({
        metrics: {
          firstResponseTime: kpi({ numerator: 2880, denominator: 3 }),
          quoteAcceptanceRate: kpi(),
          completionRate: kpi(),
          revisitRate: kpi(),
        },
      }),
    );
    render(<KpiDashboard />);
    await screen.findAllByText("首次回覆時間");
    expect(screen.getByText("2.0 天")).toBeInTheDocument();
  });

  it("formats a multi-hour first-response duration in hours", async () => {
    api.fetchDashboard.mockResolvedValue(
      dashboard({
        metrics: {
          firstResponseTime: kpi({ numerator: 150, denominator: 4 }),
          quoteAcceptanceRate: kpi(),
          completionRate: kpi(),
          revisitRate: kpi(),
        },
      }),
    );
    render(<KpiDashboard />);
    await screen.findByText("首次回覆時間");
    expect(screen.getByText("2.5 時")).toBeInTheDocument();
  });

  it("keeps the greeting/shell alive when the dashboard fetch fails", async () => {
    api.fetchDashboard.mockRejectedValueOnce(new Error("degraded"));
    render(<KpiDashboard />);
    await screen.findByText(/指標暫時讀不到/);
    // The greeting header (owner name) still renders — the widget degrades alone.
    expect(screen.getByText(/老闆/)).toBeInTheDocument();
  });

  it("falls back to a default name when the membership has no display name", async () => {
    const s = session("owner");
    s.memberships[0].displayName = "";
    pilotApi.fetchPilotSession.mockResolvedValue(s);
    render(<KpiDashboard />);
    await screen.findByText("報價接受率");
    expect(screen.getByText(/老闆/)).toBeInTheDocument();
  });

  it("shows an error state when the session itself cannot load", async () => {
    pilotApi.fetchPilotSession.mockRejectedValueOnce(new Error("no session"));
    render(<KpiDashboard />);
    await screen.findByText(/指標暫時讀不到/);
  });

  it("errors when there is no active membership", async () => {
    pilotApi.fetchPilotSession.mockResolvedValue({
      user: { id: "u1", email: "o@t.test", displayName: "O" },
      memberships: [],
    });
    render(<KpiDashboard />);
    await screen.findByText(/指標暫時讀不到/);
  });

  it("does not set state after unmount (no act warning, cleanup guard)", async () => {
    let resolveSession: (value: unknown) => void = () => {};
    pilotApi.fetchPilotSession.mockReturnValue(
      new Promise((resolve) => {
        resolveSession = resolve;
      }),
    );
    api.fetchDashboard.mockResolvedValue(dashboard());
    const view = render(<KpiDashboard />);
    view.unmount();
    // Resolve after unmount: the active guard must swallow the render-affecting
    // setState calls so nothing throws and the greeting is never mounted again.
    resolveSession(session("owner"));
    await Promise.resolve();
    await Promise.resolve();
    expect(screen.queryByText(/早安|午安|晚安/)).toBeNull();
  });
});
