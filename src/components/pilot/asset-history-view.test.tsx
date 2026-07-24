import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const pilotApi = vi.hoisted(() => ({ fetchPilotSession: vi.fn() }));
const api = vi.hoisted(() => ({ fetchAssetHistory: vi.fn() }));

vi.mock("./api", () => ({ fetchPilotSession: pilotApi.fetchPilotSession }));
vi.mock("./operations-api", () => api);

import { AssetHistoryView } from "./asset-history-view";

const ORG = "20000000-0000-4000-8000-000000000001";
const ASSET = "60000000-0000-4000-8000-000000000001";

function session(role: string) {
  return {
    user: { id: "u1", email: "o@t.test", displayName: "O" },
    memberships: [{ id: "m1", organizationId: ORG, displayName: "O", role, status: "active" }],
  };
}

function history(overrides: Record<string, unknown> = {}) {
  return {
    asset: {
      id: ASSET,
      organizationId: ORG,
      customerId: "40000000-0000-4000-8000-000000000001",
      locationId: "50000000-0000-4000-8000-000000000001",
      assetNo: "AS-2026-0001",
      assetType: "air_conditioner",
      name: "客廳分離式冷氣",
      brand: "大金",
      model: "FTXM50",
      serialNumber: "SN-123",
      installedOn: "2024-05-01",
      warrantyExpiresOn: "2027-05-01",
      lastServicedAt: "2026-01-15T00:00:00+00:00",
      status: "active",
      attributes: null,
      lockVersion: 2,
      createdAt: "2024-05-01T00:00:00+00:00",
      updatedAt: "2026-01-15T00:00:00+00:00",
    },
    events: [
      {
        eventType: "asset.serviced",
        occurredAt: "2026-01-15T00:00:00+00:00",
        payload: { summary: "年度清洗保養" },
        chainSequence: 3,
      },
    ],
    workOrders: [
      {
        workOrderId: "71100000-0000-4000-8000-000000000001",
        workOrderNo: "WO-2026-0001",
        status: "completed",
        scheduledStartAt: "2026-01-15T01:00:00+00:00",
        completedAt: "2026-01-15T03:00:00+00:00",
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  pilotApi.fetchPilotSession.mockResolvedValue(session("owner"));
  api.fetchAssetHistory.mockResolvedValue(history());
});

describe("AssetHistoryView", () => {
  it("renders the asset detail, service events, and related work orders", async () => {
    render(<AssetHistoryView assetId={ASSET} />);
    await screen.findByText("客廳分離式冷氣");
    expect(screen.getByText("大金")).toBeInTheDocument();
    expect(screen.getByText(/年度清洗保養/)).toBeInTheDocument();
    expect(screen.getByText("WO-2026-0001")).toBeInTheDocument();
    expect(screen.getByText(/冷氣 · AS-2026-0001/)).toBeInTheDocument();
  });

  it("carries no amount or cost anywhere in the asset history (technician-safe)", async () => {
    render(<AssetHistoryView assetId={ASSET} />);
    await screen.findByText("客廳分離式冷氣");
    expect(screen.queryByText(/NT\$|\$|金額|成本|毛利/)).toBeNull();
  });

  it("shows an empty-but-optional state when there is no service history yet", async () => {
    api.fetchAssetHistory.mockResolvedValue(history({ events: [], workOrders: [] }));
    render(<AssetHistoryView assetId={ASSET} />);
    await screen.findByText("客廳分離式冷氣");
    expect(screen.getByText(/尚未有服務履歷/)).toBeInTheDocument();
  });

  it("shows an error state on load failure", async () => {
    api.fetchAssetHistory.mockRejectedValueOnce(new Error("boom"));
    render(<AssetHistoryView assetId={ASSET} />);
    await screen.findByText("設備履歷讀不到");
  });

  it("does not set state after unmount (cleanup guard)", async () => {
    let resolveSession: (value: unknown) => void = () => {};
    pilotApi.fetchPilotSession.mockReturnValue(
      new Promise((resolve) => {
        resolveSession = resolve;
      }),
    );
    const view = render(<AssetHistoryView assetId={ASSET} />);
    view.unmount();
    resolveSession(session("owner"));
    await Promise.resolve();
    await Promise.resolve();
    expect(screen.queryByText("客廳分離式冷氣")).toBeNull();
  });

  it("renders dashes for missing fields and a scheduled work order", async () => {
    const base = history();
    api.fetchAssetHistory.mockResolvedValue({
      ...base,
      asset: {
        ...base.asset,
        brand: null,
        model: null,
        serialNumber: null,
        installedOn: null,
        warrantyExpiresOn: null,
        lastServicedAt: null,
      },
      events: [
        {
          eventType: "custom.unknown",
          occurredAt: "2026-02-01T00:00:00+00:00",
          payload: {},
          chainSequence: 1,
        },
      ],
      workOrders: [
        {
          workOrderId: "71100000-0000-4000-8000-000000000009",
          workOrderNo: "WO-2026-0099",
          status: "unknown_status",
          scheduledStartAt: "2026-02-01T01:00:00+00:00",
          completedAt: null,
        },
      ],
    });
    render(<AssetHistoryView assetId={ASSET} />);
    await screen.findByText("客廳分離式冷氣");
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    expect(screen.getByText(/排定/)).toBeInTheDocument();
    // An unknown event type falls back to its raw key.
    expect(screen.getByText("custom.unknown")).toBeInTheDocument();
  });

  it("marks a retired asset and still shows its history", async () => {
    const base = history();
    api.fetchAssetHistory.mockResolvedValue({
      ...base,
      asset: { ...base.asset, status: "retired" },
    });
    render(<AssetHistoryView assetId={ASSET} />);
    await screen.findByText("客廳分離式冷氣");
    expect(screen.getByText("已停用")).toBeInTheDocument();
  });
});
