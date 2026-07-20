import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PilotApiError } from "./api";
import {
  convertMaintenancePlan,
  createPaymentMilestone,
  fetchAssetHistory,
  fetchDashboard,
  fetchMaintenancePlans,
  fetchPaymentMilestones,
  finalizeDataDeletion,
  invoicePaymentMilestone,
  markPaymentMilestonePaid,
  prepareMaintenanceReminders,
  requestDataDeletion,
  reversePaymentMilestone,
  waivePaymentMilestone,
} from "./operations-api";

const ORG = "20000000-0000-4000-8000-000000000001";
const MILESTONE = "87000000-0000-4000-8000-000000000001";
const PLAN = "88000000-0000-4000-8000-000000000001";
const ASSET = "60000000-0000-4000-8000-000000000001";

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function lastCall(fetchMock: ReturnType<typeof vi.fn>): { url: string; init: RequestInit } {
  const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
  return { url, init };
}

describe("operations API client", () => {
  beforeEach(() => {
    document.cookie = "renoly-csrf=0123456789abcdef0123456789abcdef; Path=/";
  });
  afterEach(() => vi.unstubAllGlobals());

  it("lists payment milestones with query params", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ data: { milestones: [], includeAmounts: true } }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchPaymentMilestones(ORG, { status: "invoiced", projectId: "p1", limit: 20 });
    expect(result).toEqual({ milestones: [], includeAmounts: true });
    expect(lastCall(fetchMock).url).toContain("status=invoiced");
    expect(lastCall(fetchMock).url).toContain("projectId=p1");
  });

  it("creates a milestone with CSRF + Idempotency headers", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: { id: MILESTONE } }, 201));
    vi.stubGlobal("fetch", fetchMock);

    await createPaymentMilestone(ORG, { projectId: "p1", name: "款", amountMinor: 1000 });
    const { init } = lastCall(fetchMock);
    const headers = init.headers as Record<string, string>;
    expect(headers["X-CSRF-Token"]).toBeTruthy();
    expect(headers["Idempotency-Key"]).toBeTruthy();
  });

  it("sends If-Match + Idempotency on invoice/mark-paid/waive/reverse", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(jsonResponse({ data: { id: MILESTONE, lockVersion: 2 } })),
      );
    vi.stubGlobal("fetch", fetchMock);

    await invoicePaymentMilestone(ORG, MILESTONE, 1, "2026-10-01");
    expect((lastCall(fetchMock).init.headers as Record<string, string>)["If-Match"]).toBe('"1"');
    expect(JSON.parse(lastCall(fetchMock).init.body as string)).toEqual({ dueOn: "2026-10-01" });

    await invoicePaymentMilestone(ORG, MILESTONE, 1);
    expect(JSON.parse(lastCall(fetchMock).init.body as string)).toEqual({});

    await markPaymentMilestonePaid(ORG, MILESTONE, 2, { paymentMethod: "cash" });
    expect(lastCall(fetchMock).url).toContain("/actions/mark-paid");

    await waivePaymentMilestone(ORG, MILESTONE, 2, "作廢");
    expect(JSON.parse(lastCall(fetchMock).init.body as string)).toEqual({ reason: "作廢" });

    await reversePaymentMilestone(ORG, MILESTONE, 3, "誤記");
    expect(lastCall(fetchMock).url).toContain("/actions/reverse-payment");
  });

  it("throws a PilotApiError carrying the problem detail + status", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(jsonResponse({ detail: "SENSITIVE_FIELD_REJECTED" }, 422)),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(markPaymentMilestonePaid(ORG, MILESTONE, 1)).rejects.toMatchObject({
      status: 422,
    });
    await expect(markPaymentMilestonePaid(ORG, MILESTONE, 1)).rejects.toBeInstanceOf(PilotApiError);
  });

  it("falls back to a friendly message when the error body is unparseable", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("not json", { status: 500, headers: { "content-type": "text/plain" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchPaymentMilestones(ORG)).rejects.toMatchObject({ status: 500 });
  });

  it("lists maintenance plans and unwraps the plans array", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: { plans: [{ id: PLAN }] } }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchMaintenancePlans(ORG, { status: "active" })).resolves.toEqual([{ id: PLAN }]);
  });

  it("prepares reminders and converts a plan (default + forced)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ data: { prepared: 2, skipped: 0 } }))
      .mockResolvedValueOnce(jsonResponse({ data: { serviceRequestId: "sr1", replayed: false } }, 201))
      .mockResolvedValueOnce(jsonResponse({ data: { serviceRequestId: "sr2", replayed: false } }, 201));
    vi.stubGlobal("fetch", fetchMock);

    await expect(prepareMaintenanceReminders(ORG, [PLAN])).resolves.toEqual({ prepared: 2, skipped: 0 });

    await convertMaintenancePlan(ORG, PLAN, 1, { subject: "回訪" });
    expect(JSON.parse(lastCall(fetchMock).init.body as string)).toEqual({ subject: "回訪" });

    await convertMaintenancePlan(ORG, PLAN, 1, { subject: "回訪", force: true });
    expect(JSON.parse(lastCall(fetchMock).init.body as string)).toEqual({ subject: "回訪", force: true });
  });

  it("reads asset history and the dashboard", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ data: { asset: { id: ASSET }, events: [], workOrders: [] } }))
      .mockResolvedValueOnce(jsonResponse({ data: { window: {}, metrics: {} } }))
      .mockResolvedValueOnce(jsonResponse({ data: { window: {}, metrics: {} } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchAssetHistory(ORG, ASSET)).resolves.toMatchObject({ asset: { id: ASSET } });

    await fetchDashboard(ORG, { from: "2026-01-01", to: "2026-06-30" });
    expect(lastCall(fetchMock).url).toContain("from=2026-01-01");

    await fetchDashboard(ORG);
    expect(lastCall(fetchMock).url).not.toContain("?");
  });

  it("requests then finalizes data deletion", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ data: { deletionRequestId: "d1", status: "requested" } }, 202))
      .mockResolvedValueOnce(jsonResponse({ data: { status: "finalized", anonymizedCustomers: 3 } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(requestDataDeletion(ORG, "reauth-token-1234")).resolves.toMatchObject({
      deletionRequestId: "d1",
    });
    await expect(finalizeDataDeletion(ORG, "d1", "reauth-token-1234")).resolves.toMatchObject({
      status: "finalized",
    });
  });
});
