import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PilotRequestDetail } from "./request-detail";
import type {
  ConversionResult,
  ServiceRequestActionResult,
  ServiceRequestDetail,
} from "./triage-api";

const organizationId = "20000000-0000-4000-8000-000000000001";
const requestId = "80000000-0000-4000-8000-000000000001";
const customerId = "90000000-0000-4000-8000-000000000001";

const api = vi.hoisted(() => ({
  fetchServiceRequestDetail: vi.fn(),
  patchServiceRequestSummary: vi.fn(),
  triageServiceRequest: vi.fn(),
  convertServiceRequest: vi.fn(),
  declineServiceRequest: vi.fn(),
  cancelServiceRequest: vi.fn(),
  fetchSimilarCustomers: vi.fn(),
  fetchCustomerLocations: vi.fn(),
  fetchCustomerAssets: vi.fn(),
  fetchOrganizationMembers: vi.fn(),
  createCustomer: vi.fn(),
}));

const pilotApi = vi.hoisted(() => {
  class MockPilotApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  }
  return {
    fetchPilotSession: vi.fn(),
    PilotApiError: MockPilotApiError,
  };
});

const MockPilotApiError = pilotApi.PilotApiError;

vi.mock("./triage-api", () => api);
vi.mock("./api", () => ({
  fetchPilotSession: pilotApi.fetchPilotSession,
  PilotApiError: pilotApi.PilotApiError,
}));

function baseDetail(overrides: Partial<ServiceRequestDetail> = {}): ServiceRequestDetail {
  return {
    id: requestId,
    requestNo: "R-2026-0012",
    customerId: null,
    locationId: null,
    assetId: null,
    source: "web",
    status: "new",
    priority: "normal",
    category: null,
    subject: "兩台分離式冷氣有異味",
    title: "兩台分離式冷氣有異味",
    description: "希望週六上午到府",
    contactName: "林太太",
    contactPhone: "+886912345678",
    contactEmail: null,
    assignedMemberId: null,
    internalNote: "",
    preferredWindows: [{ startsAt: "2026-07-19T01:00:00.000Z", endsAt: "2026-07-19T03:00:00.000Z", preferenceRank: 1 }],
    originalSubmission: {
      contactName: "林太太",
      contactPhone: "+886912345678",
      subject: "冷氣有異味",
      description: "希望週六上午到府，兩台",
      source: "web",
      submittedAt: "2026-07-16T01:42:00.000Z",
    },
    summaryEditedBy: null,
    summaryEditedAt: null,
    triagedAt: null,
    convertedAt: null,
    convertedProjectId: null,
    convertedWorkOrderId: null,
    convertedProjectNo: null,
    convertedWorkOrderNo: null,
    declineReason: null,
    cancellationReason: null,
    photos: [],
    lockVersion: 1,
    createdAt: "2026-07-16T01:42:00.000Z",
    updatedAt: "2026-07-16T01:42:00.000Z",
    ...overrides,
  };
}

// The triage / decline / cancel routes reply with the compact ActionResult
// projection (no content columns), not the full detail DTO. Mock that real shape
// so the merge path in the component is exercised faithfully.
function actionResult(
  overrides: Partial<ServiceRequestActionResult> = {},
): ServiceRequestActionResult {
  return {
    id: requestId,
    status: "triaged",
    priority: "normal",
    category: null,
    customerId: null,
    locationId: null,
    assetId: null,
    assignedMemberId: null,
    triagedAt: "2026-07-19T05:00:00.000Z",
    convertedAt: null,
    convertedProjectId: null,
    convertedWorkOrderId: null,
    lockVersion: 2,
    updatedAt: "2026-07-19T05:00:00.000Z",
    ...overrides,
  };
}

function sessionWithRole(role = "owner") {
  return {
    user: { id: "u1", email: "o@e.test", displayName: "王老闆" },
    memberships: [
      { id: "m1", organizationId, role, status: "active", displayName: "王老闆" },
    ],
  };
}

function renderDetail() {
  return render(
    <PilotRequestDetail organizationId={organizationId} requestId={requestId} />,
  );
}

function renderStrictDetail() {
  return render(
    <StrictMode>
      <PilotRequestDetail organizationId={organizationId} requestId={requestId} />
    </StrictMode>,
  );
}

describe("PilotRequestDetail", () => {
  beforeEach(() => {
    document.cookie = "renoly-csrf=0123456789abcdef0123456789abcdef; Path=/";
    pilotApi.fetchPilotSession.mockResolvedValue(sessionWithRole());
    api.fetchServiceRequestDetail.mockResolvedValue(baseDetail());
    api.fetchSimilarCustomers.mockResolvedValue([]);
    api.fetchCustomerLocations.mockResolvedValue([]);
    api.fetchCustomerAssets.mockResolvedValue([]);
    api.fetchOrganizationMembers.mockResolvedValue([
      { id: "m1", displayName: "王老闆", role: "owner", status: "active" },
      { id: "m2", displayName: "師傅阿明", role: "technician", status: "active" },
    ]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("shows a loading skeleton then the original submission read-only alongside the editable summary", async () => {
    renderDetail();

    expect(screen.getByRole("status", { name: /載入/ })).toBeInTheDocument();

    expect(await screen.findByRole("heading", { name: /原始需求/ })).toBeInTheDocument();
    // Original submission text is present and read-only.
    expect(screen.getByText("希望週六上午到府，兩台")).toBeInTheDocument();
    // Editable summary uses the canonical subject.
    const subjectInput = screen.getByLabelText("主旨") as HTMLInputElement;
    expect(subjectInput.value).toBe("兩台分離式冷氣有異味");
    expect(subjectInput.readOnly).toBe(false);
  });

  it("ignores a stale StrictMode load that finishes after the user changes assignment", async () => {
    let resolveFirst!: (value: ServiceRequestDetail) => void;
    const firstLoad = new Promise<ServiceRequestDetail>((resolve) => {
      resolveFirst = resolve;
    });
    api.fetchServiceRequestDetail
      .mockImplementationOnce(() => firstLoad)
      .mockResolvedValueOnce(baseDetail());

    renderStrictDetail();

    const assignee = await screen.findByLabelText("指派師傅");
    await userEvent.selectOptions(assignee, "m2");
    expect(assignee).toHaveValue("m2");

    await act(async () => {
      resolveFirst(baseDetail({ assignedMemberId: null }));
      await firstLoad;
    });

    expect(assignee).toHaveValue("m2");
  });

  it("shows an error state with reload when the detail fails to load", async () => {
    api.fetchServiceRequestDetail.mockRejectedValueOnce(new Error("boom"));
    renderDetail();

    expect(await screen.findByRole("alert")).toHaveTextContent(/讀不到/);
    api.fetchServiceRequestDetail.mockResolvedValueOnce(baseDetail());
    await userEvent.click(screen.getByRole("button", { name: "重新載入" }));
    expect(await screen.findByRole("heading", { name: /原始需求/ })).toBeInTheDocument();
  });

  it("blocks technicians with a restricted view", async () => {
    pilotApi.fetchPilotSession.mockResolvedValue(sessionWithRole("technician"));
    renderDetail();

    expect(await screen.findByRole("heading", { name: /沒有.*權限/ })).toBeInTheDocument();
    expect(api.fetchServiceRequestDetail).not.toHaveBeenCalled();
  });

  it("saves an edited summary via PATCH with the current lock version", async () => {
    api.patchServiceRequestSummary.mockResolvedValue(
      baseDetail({ subject: "兩台分離式冷氣異味（整理後）", lockVersion: 2, summaryEditedBy: "10000000-0000-4000-8000-000000000001", summaryEditedAt: "2026-07-19T05:00:00.000Z" }),
    );
    renderDetail();

    const subjectInput = await screen.findByLabelText("主旨");
    await userEvent.clear(subjectInput);
    await userEvent.type(subjectInput, "兩台分離式冷氣異味（整理後）");
    await userEvent.click(screen.getByRole("button", { name: "儲存摘要" }));

    await waitFor(() =>
      expect(api.patchServiceRequestSummary).toHaveBeenCalledWith(
        organizationId,
        requestId,
        1,
        expect.objectContaining({ subject: "兩台分離式冷氣異味（整理後）" }),
      ),
    );
    expect(await screen.findByText(/最後編輯：團隊成員/)).toBeInTheDocument();
  });

  it("queries similar customers and lets the dispatcher explicitly link an existing one", async () => {
    api.fetchSimilarCustomers.mockResolvedValue([
      { customerId, customerNo: "C-001", name: "林太太", phone: "+886912345678", matchReason: "phone" },
    ]);
    renderDetail();

    // Hint card appears and is explicitly a comparison, not auto-merge.
    expect(await screen.findByText(/C-001/)).toBeInTheDocument();
    expect(screen.getByText(/不會自動合併/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /連結既有客戶/ }));
    // Selecting a customer loads its locations.
    await waitFor(() =>
      expect(api.fetchCustomerLocations).toHaveBeenCalledWith(organizationId, customerId),
    );
  });

  it("triages with the linked customer, category, priority and assignee using If-Match", async () => {
    api.fetchSimilarCustomers.mockResolvedValue([
      { customerId, customerNo: "C-001", name: "林太太", phone: "+886912345678", matchReason: "phone" },
    ]);
    api.fetchCustomerLocations.mockResolvedValue([
      {
        id: "loc-1",
        customerId,
        label: "住家",
        contactName: null,
        contactPhone: null,
        postalCode: "105",
        county: "台北市",
        district: "松山區",
        addressLine: "民生東路",
        accessNotes: "",
        isDefault: true,
        lockVersion: 1,
        createdAt: "2026-07-16T01:42:00.000Z",
        updatedAt: "2026-07-16T01:42:00.000Z",
      },
    ]);
    api.fetchCustomerAssets.mockResolvedValue([
      {
        id: "asset-1",
        customerId,
        locationId: "loc-1",
        assetNo: "A-001",
        assetType: "air_conditioner",
        name: "主臥冷氣",
        brand: "大金",
        model: "DEMO-01",
        serialNumber: null,
        installedOn: null,
        status: "active",
        lockVersion: 1,
        createdAt: "2026-07-16T01:42:00.000Z",
        updatedAt: "2026-07-16T01:42:00.000Z",
      },
    ]);
    api.triageServiceRequest.mockResolvedValue(
      actionResult({ status: "triaged", customerId, category: "cooling", priority: "high", lockVersion: 2 }),
    );
    renderDetail();

    await userEvent.click(await screen.findByRole("button", { name: /連結既有客戶/ }));
    await screen.findByRole("option", { name: "住家｜民生東路" });
    await userEvent.selectOptions(screen.getByLabelText("服務地址"), "loc-1");
    await screen.findByRole("option", { name: "主臥冷氣｜大金" });
    await userEvent.selectOptions(screen.getByLabelText("設備（選配）"), "asset-1");
    await userEvent.selectOptions(screen.getByLabelText("指派師傅"), "m2");

    await userEvent.selectOptions(screen.getByLabelText("服務類別"), "cooling");
    await userEvent.selectOptions(screen.getByLabelText("優先度"), "high");
    await userEvent.type(screen.getByLabelText("內部備註"), "已電話確認");
    await userEvent.click(screen.getByRole("button", { name: "分流案件" }));

    await waitFor(() =>
      expect(api.triageServiceRequest).toHaveBeenCalledWith(
        organizationId,
        requestId,
        1,
        expect.objectContaining({
          customerId,
          locationId: "loc-1",
          assetId: "asset-1",
          assignedMemberId: "m2",
          category: "cooling",
          priority: "high",
          internalNote: "已電話確認",
        }),
      ),
    );
    // The compact ActionResult is merged onto the loaded detail: content columns
    // it omits (subject header, editable subject) must survive the triage.
    expect(await screen.findByText("案件已分流。")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "兩台分離式冷氣有異味" })).toBeInTheDocument();
    expect((screen.getByLabelText("主旨") as HTMLInputElement).value).toBe("兩台分離式冷氣有異味");
  });

  it("converts a triaged request and shows the real case number without a broken link", async () => {
    api.fetchServiceRequestDetail.mockResolvedValue(
      baseDetail({ status: "triaged", customerId, locationId: "loc-1", lockVersion: 3 }),
    );
    const conversion: ConversionResult = {
      serviceRequest: {
        id: requestId,
        status: "converted",
        lockVersion: 4,
        convertedAt: "2026-07-19T06:00:00.000Z",
      },
      project: null,
      workOrder: { id: "wo-1", workOrderNo: "WO-202607-000001", title: "冷氣清洗", status: "draft" },
      replayed: false,
    };
    api.convertServiceRequest.mockResolvedValue(conversion);
    renderDetail();

    await userEvent.click(await screen.findByRole("button", { name: "轉換為案件" }));
    // Confirm dialog -> confirm.
    await userEvent.click(await screen.findByRole("button", { name: "確認轉換" }));

    await waitFor(() =>
      expect(api.convertServiceRequest).toHaveBeenCalledWith(
        organizationId,
        requestId,
        3,
        expect.any(String),
        expect.objectContaining({ mode: "singleVisit" }),
      ),
    );
    expect(await screen.findByText("WO-202607-000001")).toBeInTheDocument();
    // M5: the converted state now links to the real work-order workspace.
    const link = screen.getByRole("link", { name: "前往工單工作台" });
    expect(link).toHaveAttribute("href", "/app/work-orders/wo-1");
  });

  it("links to the work-order workspace and disables convert when already converted on load", async () => {
    api.fetchServiceRequestDetail.mockResolvedValue(
      baseDetail({
        status: "converted",
        customerId,
        locationId: "loc-1",
        convertedWorkOrderId: "wo-9",
        convertedWorkOrderNo: "WO-202607-000009",
        lockVersion: 5,
      }),
    );
    renderDetail();

    const link = await screen.findByRole("link", { name: "前往工單工作台" });
    expect(link).toHaveAttribute("href", "/app/work-orders/wo-9");
    expect(screen.queryByRole("button", { name: "轉換為案件" })).not.toBeInTheDocument();
  });

  it("shows a conflict toast and refetches on a 412 during triage", async () => {
    api.fetchSimilarCustomers.mockResolvedValue([
      { customerId, customerNo: "C-001", name: "林太太", phone: "+886912345678", matchReason: "phone" },
    ]);
    api.triageServiceRequest.mockRejectedValueOnce(new MockPilotApiError("版本衝突", 412));
    renderDetail();

    await userEvent.click(await screen.findByRole("button", { name: /連結既有客戶/ }));
    await userEvent.click(screen.getByRole("button", { name: "分流案件" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/已被他人更新|重新載入了最新/);
    // Detail is refetched after the conflict (initial load + refetch).
    await waitFor(() => expect(api.fetchServiceRequestDetail).toHaveBeenCalledTimes(2));
  });

  it("declines with a required reason", async () => {
    api.declineServiceRequest.mockResolvedValue(actionResult({ status: "declined", lockVersion: 2 }));
    renderDetail();

    await userEvent.click(await screen.findByRole("button", { name: "標為不適用" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText(/原因/), "不在服務範圍");
    await userEvent.click(within(dialog).getByRole("button", { name: "確認標為不適用" }));

    await waitFor(() =>
      expect(api.declineServiceRequest).toHaveBeenCalledWith(
        organizationId,
        requestId,
        1,
        "不在服務範圍",
      ),
    );
  });

  it("requests more info locally and offers a copy link without sending anything", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    renderDetail();

    await userEvent.click(await screen.findByRole("button", { name: "要求補資料" }));
    expect(await screen.findByText(/待補資料/)).toBeInTheDocument();
    // No LINE send occurs; a copyable link/instruction is offered.
    await userEvent.click(screen.getByRole("button", { name: /複製/ }));
    expect(writeText).toHaveBeenCalled();
    expect(await screen.findByText(/已複製/)).toBeInTheDocument();
    // No mutation endpoint was hit for request-more-info.
    expect(api.triageServiceRequest).not.toHaveBeenCalled();
  });

  it("cancels with a required reason", async () => {
    api.cancelServiceRequest.mockResolvedValue(actionResult({ status: "cancelled", lockVersion: 2 }));
    renderDetail();

    await userEvent.click(await screen.findByRole("button", { name: "取消案件" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText(/原因/), "客戶自行取消");
    await userEvent.click(within(dialog).getByRole("button", { name: "確認取消" }));

    await waitFor(() =>
      expect(api.cancelServiceRequest).toHaveBeenCalledWith(
        organizationId,
        requestId,
        1,
        "客戶自行取消",
      ),
    );
  });

  it("rejects a too-short close reason before calling the API", async () => {
    renderDetail();

    await userEvent.click(await screen.findByRole("button", { name: "標為不適用" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText(/原因/), "x");
    await userEvent.click(within(dialog).getByRole("button", { name: "確認標為不適用" }));

    expect(await screen.findByText(/至少兩個字/)).toBeInTheDocument();
    expect(api.declineServiceRequest).not.toHaveBeenCalled();
  });

  it("blocks triage until a customer is linked", async () => {
    renderDetail();

    await screen.findByRole("heading", { name: /原始需求/ });
    await userEvent.click(screen.getByRole("button", { name: "分流案件" }));

    expect(await screen.findByText(/請先連結或建立客戶/)).toBeInTheDocument();
    expect(api.triageServiceRequest).not.toHaveBeenCalled();
  });

  it("creates and persists a real customer before binding it", async () => {
    api.createCustomer.mockResolvedValue({
      id: customerId,
      customerNo: "CU-202607-000001",
      kind: "individual",
      name: "林太太",
      phone: "+886912345678",
      email: null,
      companyName: null,
      source: "manual",
      notes: "",
      lastContactAt: "2026-07-19T05:00:00.000Z",
      lockVersion: 1,
      createdAt: "2026-07-19T05:00:00.000Z",
      updatedAt: "2026-07-19T05:00:00.000Z",
    });
    renderDetail();

    await userEvent.click(await screen.findByRole("button", { name: "建立新客戶" }));
    await waitFor(() =>
      expect(api.createCustomer).toHaveBeenCalledWith(organizationId, {
        name: "林太太",
        phone: "+886912345678",
      }),
    );
    expect(await screen.findByText(/已連結客戶/)).toBeInTheDocument();
    expect(screen.getAllByText(/CU-202607-000001/)).toHaveLength(2);

    await userEvent.click(screen.getByRole("button", { name: "改為其他客戶" }));
    expect(await screen.findByRole("button", { name: "建立新客戶" })).toBeInTheDocument();
  });

  it("keeps the request unbound when customer creation fails", async () => {
    api.createCustomer.mockRejectedValueOnce(new Error("建立失敗"));
    renderDetail();

    await userEvent.click(await screen.findByRole("button", { name: "建立新客戶" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("建立失敗");
    expect(screen.getByRole("button", { name: "建立新客戶" })).toBeInTheDocument();
    expect(screen.queryByText(/已連結客戶/)).not.toBeInTheDocument();
  });

  it("deduplicates rapid customer-create clicks while the request is in flight", async () => {
    api.createCustomer.mockImplementation(() => new Promise(() => undefined));
    renderDetail();

    const button = await screen.findByRole("button", { name: "建立新客戶" });
    fireEvent.click(button);
    fireEvent.click(button);

    expect(api.createCustomer).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "建立中…" })).toBeDisabled();
  });

  it("preloads customer locations when the request is already linked", async () => {
    api.fetchServiceRequestDetail.mockResolvedValue(
      baseDetail({ status: "triaged", customerId, locationId: "loc-1", lockVersion: 2 }),
    );
    renderDetail();

    await screen.findByRole("heading", { name: /原始需求/ });
    await waitFor(() =>
      expect(api.fetchCustomerLocations).toHaveBeenCalledWith(organizationId, customerId),
    );
  });

  it("selects a location during triage and includes it in the payload", async () => {
    api.fetchSimilarCustomers.mockResolvedValue([
      { customerId, customerNo: "C-001", name: "林太太", phone: "+886912345678", matchReason: "phone" },
    ]);
    api.fetchCustomerLocations.mockResolvedValue([
      { id: "loc-1", customerId, label: "住家", addressLine1: "民生東路", addressLine2: null, postalCode: "105" },
    ]);
    api.triageServiceRequest.mockResolvedValue(
      baseDetail({ status: "triaged", customerId, locationId: "loc-1", lockVersion: 2 }),
    );
    renderDetail();

    await userEvent.click(await screen.findByRole("button", { name: /連結既有客戶/ }));
    await userEvent.selectOptions(await screen.findByLabelText("服務地址"), "loc-1");
    await userEvent.click(screen.getByRole("button", { name: "分流案件" }));

    await waitFor(() =>
      expect(api.triageServiceRequest).toHaveBeenCalledWith(
        organizationId,
        requestId,
        1,
        expect.objectContaining({ customerId, locationId: "loc-1" }),
      ),
    );
  });

  it("shows a conflict toast and refetches on a 412 while saving the summary", async () => {
    api.patchServiceRequestSummary.mockRejectedValueOnce(new MockPilotApiError("衝突", 412));
    renderDetail();

    const subjectInput = await screen.findByLabelText("主旨");
    await userEvent.type(subjectInput, "！");
    await userEvent.click(screen.getByRole("button", { name: "儲存摘要" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/重新載入了最新|已被他人更新/);
    await waitFor(() => expect(api.fetchServiceRequestDetail).toHaveBeenCalledTimes(2));
  });

  it("reports a copy failure when the clipboard is unavailable", async () => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    });
    renderDetail();

    await userEvent.click(await screen.findByRole("button", { name: "要求補資料" }));
    await userEvent.click(screen.getByRole("button", { name: /複製/ }));

    expect(await screen.findByText(/無法自動複製/)).toBeInTheDocument();
  });

  it("closes the convert dialog without converting when cancelled", async () => {
    api.fetchServiceRequestDetail.mockResolvedValue(
      baseDetail({ status: "triaged", customerId, locationId: "loc-1", lockVersion: 3 }),
    );
    renderDetail();

    await userEvent.click(await screen.findByRole("button", { name: "轉換為案件" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.selectOptions(within(dialog).getByLabelText("轉換方式"), "project");
    await userEvent.click(within(dialog).getByRole("button", { name: "取消" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.convertServiceRequest).not.toHaveBeenCalled();
  });

  it("surfaces a non-conflict error message when triage fails", async () => {
    api.fetchSimilarCustomers.mockResolvedValue([
      { customerId, customerNo: "C-001", name: "林太太", phone: "+886912345678", matchReason: "phone" },
    ]);
    api.triageServiceRequest.mockRejectedValueOnce(new Error("伺服器忙碌"));
    renderDetail();

    await userEvent.click(await screen.findByRole("button", { name: /連結既有客戶/ }));
    await userEvent.click(screen.getByRole("button", { name: "分流案件" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("伺服器忙碌");
    // A plain error does not trigger a refetch.
    expect(api.fetchServiceRequestDetail).toHaveBeenCalledTimes(1);
  });
});
