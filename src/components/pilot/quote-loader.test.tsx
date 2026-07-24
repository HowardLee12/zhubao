import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { quoteWorkspaceFixture } from "@/testing/quote-fixtures";

import { PilotQuoteLoader } from "./quote-loader";
import type { ServiceRequestDetail } from "./triage-api";

const organizationId = "20000000-0000-4000-8000-000000000001";
const requestId = "80000000-0000-4000-8000-000000000001";
const quoteId = "92000000-0000-4000-8000-000000000001";

const mocks = vi.hoisted(() => ({
  fetchPilotSession: vi.fn(),
  fetchQuoteWorkspace: vi.fn(),
  fetchQuoteWorkspaceForRequest: vi.fn(),
  fetchServiceRequestDetail: vi.fn(),
}));

vi.mock("./api", async (importOriginal) => {
  const original = await importOriginal<typeof import("./api")>();
  return { ...original, fetchPilotSession: mocks.fetchPilotSession };
});
vi.mock("./quote-api", () => ({
  fetchQuoteWorkspace: mocks.fetchQuoteWorkspace,
  fetchQuoteWorkspaceForRequest: mocks.fetchQuoteWorkspaceForRequest,
}));
vi.mock("./triage-api", () => ({
  fetchServiceRequestDetail: mocks.fetchServiceRequestDetail,
}));
vi.mock("./quote-editor", () => ({
  PilotQuoteEditor: (props: {
    organizationId: string;
    role: string;
    request: ServiceRequestDetail | null;
    initialWorkspace: unknown;
  }) => (
    <div data-testid="quote-editor">
      {props.organizationId}:{props.role}:{props.request?.id ?? "no-request"}:
      {props.initialWorkspace ? "workspace" : "new"}
    </div>
  ),
}));

function session(role: string) {
  return {
    user: { id: "u1", email: "owner@example.test", displayName: "王老闆" },
    memberships: [
      { id: "m1", organizationId, role, status: "active", displayName: "王老闆" },
    ],
  };
}

function request(overrides: Partial<ServiceRequestDetail> = {}): ServiceRequestDetail {
  return {
    id: requestId,
    requestNo: "R-2026-0012",
    customerId: "90000000-0000-4000-8000-000000000001",
    locationId: "91000000-0000-4000-8000-000000000001",
    assetId: null,
    source: "web",
    status: "triaged",
    priority: "normal",
    category: "cooling",
    subject: "冷氣清洗",
    title: "冷氣清洗",
    description: "兩台",
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
    ...overrides,
  };
}

describe("PilotQuoteLoader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchPilotSession.mockResolvedValue(session("owner"));
    mocks.fetchServiceRequestDetail.mockResolvedValue(request());
    mocks.fetchQuoteWorkspaceForRequest.mockResolvedValue(null);
    mocks.fetchQuoteWorkspace.mockResolvedValue(quoteWorkspaceFixture());
  });

  afterEach(() => vi.clearAllMocks());

  it("loads a triaged request and opens a new persisted quote workspace", async () => {
    render(<PilotQuoteLoader requestId={requestId} />);

    expect(screen.getByRole("status", { name: "正在載入報價" })).toBeInTheDocument();
    expect(await screen.findByTestId("quote-editor")).toHaveTextContent(
      `${organizationId}:owner:${requestId}:new`,
    );
    expect(mocks.fetchQuoteWorkspaceForRequest).toHaveBeenCalledWith(organizationId, requestId);
  });

  it("reopens an existing quote by aggregate id", async () => {
    render(<PilotQuoteLoader quoteId={quoteId} />);

    expect(await screen.findByTestId("quote-editor")).toHaveTextContent(
      `${organizationId}:owner:no-request:workspace`,
    );
    expect(mocks.fetchQuoteWorkspace).toHaveBeenCalledWith(organizationId, quoteId);
    expect(mocks.fetchServiceRequestDetail).not.toHaveBeenCalled();
  });

  it("blocks technicians before loading any quote data", async () => {
    mocks.fetchPilotSession.mockResolvedValue(session("technician"));
    render(<PilotQuoteLoader requestId={requestId} />);

    expect(await screen.findByRole("heading", { name: "沒有管理報價的權限" })).toBeInTheDocument();
    expect(mocks.fetchServiceRequestDetail).not.toHaveBeenCalled();
    expect(mocks.fetchQuoteWorkspaceForRequest).not.toHaveBeenCalled();
  });

  it("returns the owner to triage when customer or location binding is missing", async () => {
    mocks.fetchServiceRequestDetail.mockResolvedValue(request({ locationId: null }));
    render(<PilotQuoteLoader requestId={requestId} />);

    expect(await screen.findByRole("heading", { name: "還不能建立報價" })).toBeInTheDocument();
    expect(screen.getByText(/綁定客戶與服務地點/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "回到進件確認" })).toHaveAttribute(
      "href",
      `/app/inbox/${requestId}`,
    );
  });

  it("shows a retryable error without rendering an empty editor", async () => {
    mocks.fetchServiceRequestDetail.mockRejectedValue(new Error("offline"));
    render(<PilotQuoteLoader requestId={requestId} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("報價暫時讀不到");
    expect(screen.queryByTestId("quote-editor")).not.toBeInTheDocument();
    expect(mocks.fetchQuoteWorkspaceForRequest).toHaveBeenCalled();
    await waitFor(() => expect(mocks.fetchServiceRequestDetail).toHaveBeenCalledTimes(1));
  });
});
