import type { PublicQuote, QuoteWorkspace } from "@/schemas/quote";

export const quoteFixtureIds = {
  organization: "20000000-0000-4000-8000-000000000001",
  request: "80000000-0000-4000-8000-000000000001",
  customer: "90000000-0000-4000-8000-000000000001",
  location: "91000000-0000-4000-8000-000000000001",
  quote: "92000000-0000-4000-8000-000000000001",
  version: "93000000-0000-4000-8000-000000000001",
  item: "94000000-0000-4000-8000-000000000001",
} as const;

export function quoteWorkspaceFixture(
  quoteStatus: QuoteWorkspace["quote"]["status"] = "draft",
  versionStatus: QuoteWorkspace["version"]["status"] = "draft",
): QuoteWorkspace {
  const ids = quoteFixtureIds;
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
      rejectedAt: quoteStatus === "rejected" ? "2026-07-19T06:20:00.000Z" : null,
      rejectionReason: quoteStatus === "rejected" ? "預算需要調整" : null,
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
      internalNotes: "熟客，成本不可外流",
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
    location: {
      id: ids.location,
      label: "住家",
      address: "台北市松山區民生東路四段 88 號",
    },
  };
}

export function publicQuoteFixture(overrides: Partial<PublicQuote> = {}): PublicQuote {
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
