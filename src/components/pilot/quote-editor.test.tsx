import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { QuoteWorkspace } from "@/schemas/quote";

import { PilotQuoteEditor } from "./quote-editor";
import type { ServiceRequestDetail } from "./triage-api";

const ids = {
  organization: "20000000-0000-4000-8000-000000000001",
  request: "80000000-0000-4000-8000-000000000001",
  customer: "90000000-0000-4000-8000-000000000001",
  location: "91000000-0000-4000-8000-000000000001",
  quote: "92000000-0000-4000-8000-000000000001",
  version: "93000000-0000-4000-8000-000000000001",
  item: "94000000-0000-4000-8000-000000000001",
};

const api = vi.hoisted(() => ({
  createQuote: vi.fn(),
  saveQuoteDraft: vi.fn(),
  sendQuote: vi.fn(),
  rotateQuotePublicLink: vi.fn(),
  cloneRejectedQuote: vi.fn(),
}));

const router = vi.hoisted(() => ({ replace: vi.fn() }));

vi.mock("./quote-api", () => api);
vi.mock("next/navigation", () => ({ useRouter: () => router }));

function request(): ServiceRequestDetail {
  return {
    id: ids.request,
    requestNo: "R-2026-0012",
    customerId: ids.customer,
    locationId: ids.location,
    assetId: null,
    source: "web",
    status: "triaged",
    priority: "normal",
    category: "cooling",
    subject: "兩台冷氣清洗",
    title: "兩台冷氣清洗",
    description: "客廳與主臥各一台",
    contactName: "林太太",
    contactPhone: "+886912345678",
    contactEmail: null,
    assignedMemberId: null,
    internalNote: "",
    preferredWindows: [],
    originalSubmission: null,
    summaryEditedBy: null,
    summaryEditedAt: null,
    triagedAt: "2026-07-19T05:00:00.000Z",
    convertedAt: null,
    convertedProjectId: null,
    convertedWorkOrderId: null,
    convertedProjectNo: null,
    convertedWorkOrderNo: null,
    declineReason: null,
    cancellationReason: null,
    photos: [],
    lockVersion: 2,
    createdAt: "2026-07-19T04:00:00.000Z",
    updatedAt: "2026-07-19T05:00:00.000Z",
  };
}

function workspace(
  quoteStatus: QuoteWorkspace["quote"]["status"] = "draft",
  versionStatus: QuoteWorkspace["version"]["status"] = "draft",
): QuoteWorkspace {
  return {
    quote: {
      id: ids.quote,
      quoteNo: "Q-202607-000001",
      serviceRequestId: ids.request,
      customerId: ids.customer,
      locationId: ids.location,
      status: quoteStatus,
      currency: "TWD",
      latestVersionId: ids.version,
      activeVersionId: quoteStatus === "draft" ? null : ids.version,
      acceptedVersionId: quoteStatus === "accepted" ? ids.version : null,
      sentAt: quoteStatus === "draft" ? null : "2026-07-19T06:00:00.000Z",
      firstViewedAt: quoteStatus === "viewed" ? "2026-07-19T06:10:00.000Z" : null,
      acceptedAt: quoteStatus === "accepted" ? "2026-07-19T06:20:00.000Z" : null,
      rejectedAt: null,
      rejectionReason: null,
      expiresAt: null,
      lockVersion: quoteStatus === "draft" ? 1 : 2,
      createdAt: "2026-07-19T05:30:00.000Z",
      updatedAt: "2026-07-19T05:30:00.000Z",
    },
    version: {
      id: ids.version,
      quoteId: ids.quote,
      versionNo: 1,
      status: versionStatus,
      approvalStatus: quoteStatus === "draft" ? "not_submitted" : "approved",
      title: "兩台冷氣清洗報價",
      validUntil: "2026-08-02",
      customerNotes: "現場追加項目會先確認。",
      internalNotes: "熟客",
      terms: "完工後付款。",
      subtotalMinor: "5000",
      discountMinor: "0",
      taxMinor: "0",
      totalMinor: "5000",
      items: [
        {
          id: ids.item,
          serviceCatalogItemId: null,
          groupName: "服務項目",
          name: "分離式冷氣清洗",
          specification: "兩台",
          unit: "台",
          quantity: "2.000",
          unitCostMinor: "1200",
          unitPriceMinor: "2500",
          discountMinor: "0",
          taxRate: "0.0000",
          sortOrder: 10,
          subtotalMinor: "5000",
          taxMinor: "0",
          totalMinor: "5000",
        },
      ],
      createdAt: "2026-07-19T05:30:00.000Z",
      updatedAt: "2026-07-19T05:30:00.000Z",
    },
    request: {
      id: ids.request,
      requestNo: "R-2026-0012",
      subject: "兩台冷氣清洗",
      status: quoteStatus === "draft" ? "quoting" : "quoted",
      lockVersion: quoteStatus === "draft" ? 3 : 4,
    },
    customer: { id: ids.customer, name: "林太太", phone: "+886912345678" },
    location: { id: ids.location, label: "住家", address: "台北市松山區民生東路四段 88 號" },
  };
}

describe("PilotQuoteEditor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("crypto", { randomUUID: vi.fn(() => "request-key") });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("creates a real draft from a triaged request and previews calculated totals", async () => {
    api.createQuote.mockResolvedValue(workspace());
    render(
      <PilotQuoteEditor
        organizationId={ids.organization}
        role="owner"
        request={request()}
      />,
    );

    fireEvent.change(screen.getByLabelText("品項 1 客戶單價"), {
      target: { value: "2500" },
    });
    expect(screen.getByText("$2,500")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "建立並儲存草稿" }));

    await waitFor(() => expect(api.createQuote).toHaveBeenCalledTimes(1));
    expect(api.createQuote).toHaveBeenCalledWith(
      ids.organization,
      2,
      "request-key",
      expect.objectContaining({
        serviceRequestId: ids.request,
        customerId: ids.customer,
        locationId: ids.location,
        version: expect.objectContaining({
          items: [expect.objectContaining({ unitPriceMinor: "2500" })],
        }),
      }),
    );
    expect(router.replace).toHaveBeenCalledWith(`/app/quotes/${ids.quote}`);
    expect(await screen.findByText(/重新整理也不會消失/)).toBeInTheDocument();
  });

  it("requires owner confirmation, locks the saved version, and exposes the one-time public URL", async () => {
    const initial = workspace();
    const publicQuoteUrl = "https://app.renoly.test/public/quotes/secure-token";
    api.sendQuote.mockResolvedValue({
      ...workspace("sent", "sent"),
      publicQuoteUrl,
    });
    render(
      <PilotQuoteEditor
        organizationId={ids.organization}
        role="owner"
        request={null}
        initialWorkspace={initial}
      />,
    );

    const sendButton = screen.getByRole("button", { name: "核准並建立分享連結" });
    expect(sendButton).toBeDisabled();
    await userEvent.click(screen.getByRole("checkbox", { name: /我已檢查價格/ }));
    await userEvent.click(sendButton);

    await waitFor(() => expect(api.sendQuote).toHaveBeenCalledWith(ids.organization, initial, "request-key"));
    expect(screen.getByLabelText("客戶報價連結")).toHaveValue(publicQuoteUrl);
    expect(screen.getByText(/尚未接 LINE 自動通知/)).toBeInTheDocument();
  });

  it("lets dispatchers save but not approve a quote", () => {
    render(
      <PilotQuoteEditor
        organizationId={ids.organization}
        role="dispatcher"
        request={null}
        initialWorkspace={workspace()}
      />,
    );

    expect(screen.getByRole("button", { name: "儲存草稿" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "核准並建立分享連結" })).not.toBeInTheDocument();
    expect(screen.getByText(/需由 owner／admin/)).toBeInTheDocument();
  });

  it("removes internal cost from customer preview mode", async () => {
    render(
      <PilotQuoteEditor
        organizationId={ids.organization}
        role="owner"
        request={null}
        initialWorkspace={workspace()}
      />,
    );
    expect(screen.getByLabelText("品項 1 內部成本")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "客戶預覽版" }));
    expect(screen.queryByLabelText("品項 1 內部成本")).not.toBeInTheDocument();
  });
});
