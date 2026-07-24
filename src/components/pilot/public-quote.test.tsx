import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PublicQuote } from "@/schemas/quote";

import { PilotApiError } from "./api";
import { PilotPublicQuote } from "./public-quote";

const token = "x".repeat(43);

const api = vi.hoisted(() => ({
  fetchPublicQuote: vi.fn(),
  respondPublicQuote: vi.fn(),
}));

vi.mock("./quote-api", () => api);

function quote(overrides: Partial<PublicQuote> = {}): PublicQuote {
  return {
    merchant: { name: "安心工程", phone: "+886223456789" },
    quoteNo: "Q-202607-000001",
    versionNo: 1,
    status: "viewed",
    validUntil: "2026-08-02",
    title: "兩台冷氣清洗報價",
    items: [
      {
        name: "分離式冷氣清洗",
        specification: "客廳與主臥各一台",
        unit: "台",
        quantity: "2.000",
        unitPriceMinor: "2500",
        discountMinor: "0",
        totalMinor: "5000",
      },
    ],
    subtotalMinor: "5000",
    discountMinor: "0",
    taxMinor: "0",
    totalMinor: "5000",
    currency: "TWD",
    customerNotes: "追加項目會先確認。",
    terms: "完工後付款。",
    decision: null,
    ...overrides,
  };
}

describe("PilotPublicQuote", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("crypto", { randomUUID: vi.fn(() => "decision-key") });
    api.fetchPublicQuote.mockResolvedValue(quote());
  });

  afterEach(() => vi.unstubAllGlobals());

  it("shows only the sanitized customer quote and never asks for registration", async () => {
    render(<PilotPublicQuote token={token} />);

    expect(await screen.findByRole("heading", { name: "兩台冷氣清洗報價" })).toBeInTheDocument();
    expect(screen.getByText("安心工程")).toBeInTheDocument();
    expect(screen.getAllByText("$5,000")).toHaveLength(3);
    expect(screen.getByText(/不需註冊帳號/)).toBeInTheDocument();
    expect(screen.queryByText(/內部成本|內部備註|熟客/)).not.toBeInTheDocument();
  });

  it("requires an explicit second confirmation before accepting the exact version", async () => {
    api.respondPublicQuote.mockResolvedValue({
      decision: "accept",
      recordedAt: "2026-07-19T07:00:00.000Z",
      displayName: "林太太",
      comment: "請週六上午來",
      replayed: false,
    });
    render(<PilotPublicQuote token={token} />);
    await screen.findByRole("heading", { name: "兩台冷氣清洗報價" });

    await userEvent.type(screen.getByLabelText("確認人姓名"), "林太太");
    await userEvent.type(screen.getByLabelText("給店家的備註"), "請週六上午來");
    await userEvent.click(screen.getByRole("button", { name: "接受報價" }));

    expect(api.respondPublicQuote).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toHaveTextContent("第 1 版");
    await userEvent.click(screen.getByRole("button", { name: "確認送出" }));

    await waitFor(() =>
      expect(api.respondPublicQuote).toHaveBeenCalledWith(token, "decision-key", {
        decision: "accept",
        displayName: "林太太",
        comment: "請週六上午來",
      }),
    );
    expect(await screen.findByText("已接受這份報價")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "接受報價" })).not.toBeInTheDocument();
  });

  it("shows the same safe unavailable state for an invalid or revoked link", async () => {
    api.fetchPublicQuote.mockRejectedValue(new PilotApiError("not found", 404));
    render(<PilotPublicQuote token={token} />);

    expect(await screen.findByRole("heading", { name: "這個報價連結無法使用" })).toBeInTheDocument();
    expect(screen.getByText(/索取新連結/)).toBeInTheDocument();
  });
});
