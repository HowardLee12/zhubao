import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PilotApiError } from "./api";
import {
  confirmIntakeDraft,
  dismissIntakeDraft,
  fetchIntakeDraftDetail,
  fetchIntakeDrafts,
} from "./api";

const organizationId = "20000000-0000-4000-8000-000000000001";
const draftId = "90000000-0000-4000-8000-000000000001";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function lastCall(fetchMock: ReturnType<typeof vi.fn>): [string, RequestInit] {
  return fetchMock.mock.calls.at(-1) as [string, RequestInit];
}

function headerValue(init: RequestInit, name: string): string | undefined {
  const headers = init.headers as Record<string, string> | undefined;
  return headers?.[name];
}

function draftListItem(overrides: Record<string, unknown> = {}) {
  return {
    id: draftId,
    conversationId: "a0000000-0000-4000-8000-000000000001",
    status: "pending_review",
    origin: "ai",
    source: "line",
    title: "LINE 進件（AI 摘要）",
    summary: "冷氣不冷想約人來看",
    confidence: 0.82,
    missingFields: ["contactPhone", "address"],
    lineUserId: "Uline-alpha-customer-0001",
    messageCount: 2,
    lastMessageAt: "2026-07-18T02:00:00.000Z",
    lockVersion: 1,
    createdAt: "2026-07-18T01:59:00.000Z",
    updatedAt: "2026-07-18T02:00:00.000Z",
    ...overrides,
  };
}

describe("intake-draft api helpers", () => {
  beforeEach(() => {
    document.cookie = "renoly-csrf=0123456789abcdef0123456789abcdef; Path=/";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("lists pending drafts from the { data } envelope", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ data: [draftListItem()] }));
    vi.stubGlobal("fetch", fetchMock);

    const drafts = await fetchIntakeDrafts(organizationId);

    expect(drafts).toHaveLength(1);
    expect(drafts[0].id).toBe(draftId);
    expect(drafts[0].origin).toBe("ai");
    const [url, init] = lastCall(fetchMock);
    expect(url).toContain(`/api/v2/organizations/${organizationId}/intake-drafts`);
    expect(url).toContain("status=pending_review");
    expect(init.method).toBe("GET");
  });

  it("returns an empty list (never throws) on 403 so the inbox degrades gracefully", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ title: "forbidden" }, 403));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchIntakeDrafts(organizationId)).rejects.toBeInstanceOf(PilotApiError);
  });

  it("fetches a draft detail from the envelope data field", async () => {
    const detail = {
      ...draftListItem(),
      fields: { subject: { value: "冷氣", source: "ai", confidence: 0.8 } },
      customerLineIdentityId: null,
      convertedServiceRequestId: null,
      messages: [],
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: detail }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchIntakeDraftDetail(organizationId, draftId);

    expect(result.id).toBe(draftId);
    expect(result.fields.subject.value).toBe("冷氣");
    const [url, init] = lastCall(fetchMock);
    expect(url).toBe(`/api/v2/organizations/${organizationId}/intake-drafts/${draftId}`);
    expect(init.method).toBe("GET");
  });

  it("confirms a draft with If-Match, Idempotency-Key and CSRF headers", async () => {
    const envelope = {
      serviceRequestId: "80000000-0000-4000-8000-000000000009",
      requestNo: "SR-202607-000001",
      draftId,
      draftStatus: "confirmed",
      status: "new",
      replayed: false,
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: envelope }, 201));
    vi.stubGlobal("fetch", fetchMock);

    const result = await confirmIntakeDraft(organizationId, draftId, 1, "idem-key-1", {
      fieldOverrides: { subject: { value: "冷氣清洗", source: "manual", confidence: null } },
    });

    expect(result.serviceRequestId).toBe(envelope.serviceRequestId);
    expect(result.replayed).toBe(false);
    const [url, init] = lastCall(fetchMock);
    expect(url).toBe(
      `/api/v2/organizations/${organizationId}/intake-drafts/${draftId}/actions/confirm`,
    );
    expect(init.method).toBe("POST");
    expect(headerValue(init, "If-Match")).toBe('"1"');
    expect(headerValue(init, "Idempotency-Key")).toBe("idem-key-1");
    expect(headerValue(init, "X-CSRF-Token")).toBeTruthy();
    expect(JSON.parse(init.body as string)).toEqual({
      fieldOverrides: { subject: { value: "冷氣清洗", source: "manual", confidence: null } },
    });
  });

  it("confirms with an empty body when no overrides are supplied", async () => {
    const envelope = {
      serviceRequestId: "80000000-0000-4000-8000-000000000009",
      requestNo: "SR-202607-000001",
      draftId,
      draftStatus: "confirmed",
      status: "new",
      replayed: true,
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: envelope }, 200));
    vi.stubGlobal("fetch", fetchMock);

    const result = await confirmIntakeDraft(organizationId, draftId, 2, "idem-key-2");

    expect(result.replayed).toBe(true);
    const [, init] = lastCall(fetchMock);
    expect(JSON.parse(init.body as string)).toEqual({});
  });

  it("dismisses a draft with If-Match and an optional reason", async () => {
    const envelope = { draftId, draftStatus: "dismissed", replayed: false };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: envelope }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await dismissIntakeDraft(organizationId, draftId, 1, "spam");

    expect(result.draftStatus).toBe("dismissed");
    const [url, init] = lastCall(fetchMock);
    expect(url).toBe(
      `/api/v2/organizations/${organizationId}/intake-drafts/${draftId}/actions/dismiss`,
    );
    expect(headerValue(init, "If-Match")).toBe('"1"');
    expect(JSON.parse(init.body as string)).toEqual({ reason: "spam" });
  });
});
