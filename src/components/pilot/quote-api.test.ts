import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { publicQuoteFixture, quoteFixtureIds, quoteWorkspaceFixture } from "@/testing/quote-fixtures";

import {
  cloneRejectedQuote,
  createQuote,
  fetchPublicQuote,
  fetchQuoteWorkspace,
  fetchQuoteWorkspaceForRequest,
  respondPublicQuote,
  rotateQuotePublicLink,
  saveQuoteDraft,
  sendQuote,
} from "./quote-api";

const workspace = quoteWorkspaceFixture();
const draft = {
  title: workspace.version.title,
  validUntil: workspace.version.validUntil,
  customerNotes: workspace.version.customerNotes,
  internalNotes: workspace.version.internalNotes,
  terms: workspace.version.terms,
  items: workspace.version.items.map((item) => ({
    serviceCatalogItemId: item.serviceCatalogItemId,
    groupName: item.groupName,
    name: item.name,
    specification: item.specification,
    unit: item.unit,
    quantity: item.quantity,
    unitCostMinor: item.unitCostMinor,
    unitPriceMinor: item.unitPriceMinor,
    discountMinor: item.discountMinor,
    taxRate: item.taxRate,
    sortOrder: item.sortOrder,
  })),
};

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("pilot quote API client", () => {
  beforeEach(() => {
    document.cookie = "renoly-csrf=0123456789abcdef0123456789abcdef; Path=/";
  });

  afterEach(() => vi.unstubAllGlobals());

  it("reads a quote by aggregate and by request", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ data: workspace }))
      .mockResolvedValueOnce(jsonResponse({ data: workspace }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchQuoteWorkspace(quoteFixtureIds.organization, quoteFixtureIds.quote)).resolves.toEqual(
      workspace,
    );
    await expect(
      fetchQuoteWorkspaceForRequest(quoteFixtureIds.organization, quoteFixtureIds.request),
    ).resolves.toEqual(workspace);
    expect(fetchMock.mock.calls[0]?.[0]).toContain(`/quotes/${quoteFixtureIds.quote}`);
    expect(fetchMock.mock.calls[1]?.[0]).toContain(`/service-requests/${quoteFixtureIds.request}/quote`);
  });

  it("returns null when the request has no quote", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ code: "NOT_FOUND" }, 404)));
    await expect(
      fetchQuoteWorkspaceForRequest(quoteFixtureIds.organization, quoteFixtureIds.request),
    ).resolves.toBeNull();
  });

  it("creates and saves drafts with CSRF, ETag and idempotency headers", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ data: workspace }, 201))
      .mockResolvedValueOnce(jsonResponse({ data: workspace }));
    vi.stubGlobal("fetch", fetchMock);

    await createQuote(quoteFixtureIds.organization, 2, "create-key", {
      serviceRequestId: quoteFixtureIds.request,
      customerId: quoteFixtureIds.customer,
      locationId: quoteFixtureIds.location,
      currency: "TWD",
      version: draft,
    });
    await saveQuoteDraft(quoteFixtureIds.organization, quoteFixtureIds.version, 1, draft);

    expect(fetchMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "If-Match": '"2"',
          "Idempotency-Key": "create-key",
          "X-CSRF-Token": "0123456789abcdef0123456789abcdef",
        }),
      }),
    );
    expect(fetchMock.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({
        method: "PATCH",
        headers: expect.objectContaining({ "If-Match": '"1"' }),
      }),
    );
  });

  it("sends, rotates and clones through their exact mutation resources", async () => {
    const linkResult = { ...quoteWorkspaceFixture("sent", "sent"), publicQuoteUrl: "https://x.test/q" };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ data: linkResult }))
      .mockResolvedValueOnce(jsonResponse({ data: linkResult }))
      .mockResolvedValueOnce(jsonResponse({ data: workspace }, 201));
    vi.stubGlobal("fetch", fetchMock);

    await sendQuote(quoteFixtureIds.organization, workspace, "send-key");
    await rotateQuotePublicLink(quoteFixtureIds.organization, workspace, "rotate-key");
    await cloneRejectedQuote(quoteFixtureIds.organization, workspace, "clone-key");

    expect(fetchMock.mock.calls[0]?.[0]).toContain("/actions/send");
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      versionId: quoteFixtureIds.version,
      serviceRequestLockVersion: workspace.request.lockVersion,
    });
    expect(fetchMock.mock.calls[1]?.[0]).toContain("/actions/rotate-public-link");
    expect(fetchMock.mock.calls[2]?.[0]).toContain(`/quotes/${quoteFixtureIds.quote}/versions`);
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toEqual({
      cloneFromVersionId: quoteFixtureIds.version,
    });
  });

  it("reads and responds to a public quote without staff CSRF headers", async () => {
    const decision = {
      decision: "accept" as const,
      recordedAt: "2026-07-19T07:00:00.000Z",
      displayName: "林太太",
      comment: null,
      replayed: false,
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ data: publicQuoteFixture() }))
      .mockResolvedValueOnce(jsonResponse({ data: decision }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchPublicQuote("x".repeat(43))).resolves.toEqual(publicQuoteFixture());
    await expect(
      respondPublicQuote("x".repeat(43), "decision-key", {
        decision: "accept",
        displayName: "林太太",
        comment: null,
      }),
    ).resolves.toEqual(decision);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/v2/public/quotes/current");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/v2/public/quotes/current/responses");
    expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain("x".repeat(43));
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toEqual(
      expect.objectContaining({ Authorization: `Bearer ${"x".repeat(43)}` }),
    );
    expect(fetchMock.mock.calls[1]?.[1]?.headers).toEqual(
      expect.objectContaining({
        Authorization: `Bearer ${"x".repeat(43)}`,
        "Idempotency-Key": "decision-key",
      }),
    );
    expect(fetchMock.mock.calls[1]?.[1]?.headers).not.toHaveProperty("X-CSRF-Token");
  });

  it("surfaces sanitized API problem details and falls back safely for invalid error bodies", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ detail: "報價已更新" }, 412))
      .mockResolvedValueOnce(new Response("not-json", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchQuoteWorkspace(quoteFixtureIds.organization, quoteFixtureIds.quote)).rejects.toMatchObject({
      message: "報價已更新",
      status: 412,
    });
    await expect(fetchPublicQuote("x".repeat(43))).rejects.toMatchObject({
      message: "服務暫時無法使用，請稍後再試。",
      status: 500,
    });
  });
});
