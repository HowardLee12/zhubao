import { describe, expect, it } from "vitest";

import type { IntakeDraftListItem } from "./intake-draft";
import {
  pilotInboxRpcResultSchema,
  toPilotInboxItem,
  toPilotInboxItemFromDraft,
} from "./pilot-inbox";

describe("pilotInboxRpcResultSchema", () => {
  const row = {
    id: "4c76d4c5-c978-4bdb-a918-caa82988e5fa",
    requestNo: "SR-2026-00001",
    contactName: "王先生",
    contactPhone: "+886912345678",
    subject: "浴室牆面滲水",
    description: "下雨後有水痕",
    status: "new" as const,
    priority: "normal" as const,
    category: null,
    lockVersion: 1,
    customerId: "40000000-0000-4000-8000-000000000001",
    assignedMemberId: null,
    triagedAt: null,
    serviceCatalogItemId: "71100000-0000-4000-8000-000000000001",
    serviceName: "現場估價",
    serviceCategory: "防水工程",
    address: "台北市松山區民生東路四段 88 號",
    photoCount: 2,
    preferredWindows: [
      {
        startsAt: "2026-08-10T01:00:00.000Z",
        endsAt: "2026-08-10T04:00:00.000Z",
        preferenceRank: 1,
      },
    ],
    createdAt: "2026-07-16T10:00:00.000Z",
    updatedAt: "2026-07-16T10:00:00.000Z",
  };

  const result = {
    organizationId: "20000000-0000-4000-8000-000000000001",
    items: [row],
  };

  it("accepts the allowlisted staff inbox projection", () => {
    expect(pilotInboxRpcResultSchema.parse(result)).toEqual(result);
  });

  it("accepts the triage provenance fields on a triaged row", () => {
    const triaged = {
      ...row,
      status: "triaged" as const,
      category: "waterproofing",
      lockVersion: 2,
      assignedMemberId: "30000000-0000-4000-8000-000000000002",
      triagedAt: "2026-07-17T02:00:00.000Z",
    };
    expect(
      pilotInboxRpcResultSchema.parse({
        organizationId: result.organizationId,
        items: [triaged],
      }).items[0],
    ).toEqual(triaged);
  });

  it("rejects internal tenant and storage fields on rows", () => {
    expect(() =>
      pilotInboxRpcResultSchema.parse({
        organizationId: result.organizationId,
        items: [{ ...row, storagePath: "private/photo.jpg", defaultCostMinor: 12000 }],
      }),
    ).toThrow();
  });

  it("requires the organizationId + items envelope shape", () => {
    expect(() => pilotInboxRpcResultSchema.parse([row])).toThrow();
  });

  it("maps an RPC row to the UI-facing inbox item", () => {
    expect(toPilotInboxItem(row)).toEqual({
      id: row.id,
      referenceNo: "SR-2026-00001",
      source: "web",
      contactName: "王先生",
      contactPhone: "+886912345678",
      serviceName: "現場估價",
      category: null,
      title: "浴室牆面滲水",
      description: "下雨後有水痕",
      address: "台北市松山區民生東路四段 88 號",
      photoCount: 2,
      status: "new",
      priority: "normal",
      lockVersion: 1,
      customerId: "40000000-0000-4000-8000-000000000001",
      assignedMemberId: null,
      triagedAt: null,
      createdAt: "2026-07-16T10:00:00.000Z",
    });
  });

  it("preserves nullable service and address fields through the mapper", () => {
    const mapped = toPilotInboxItem({
      ...row,
      serviceCatalogItemId: null,
      serviceName: null,
      serviceCategory: null,
      category: null,
      address: null,
    });
    expect(mapped.serviceName).toBeNull();
    expect(mapped.category).toBeNull();
    expect(mapped.address).toBeNull();
  });
});

describe("toPilotInboxItemFromDraft", () => {
  function draft(overrides: Partial<IntakeDraftListItem> = {}): IntakeDraftListItem {
    return {
      id: "90000000-0000-4000-8000-000000000001",
      conversationId: "a0000000-0000-4000-8000-000000000001",
      status: "pending_review",
      origin: "ai",
      source: "line",
      title: "LINE 進件（AI 摘要）",
      summary: "冷氣不冷想約人來看",
      confidence: 0.82,
      missingFields: ["contactPhone"],
      lineUserId: "Uline-alpha-customer-0001",
      messageCount: 2,
      lastMessageAt: "2026-07-18T02:00:00.000Z",
      lockVersion: 3,
      createdAt: "2026-07-18T01:59:00.000Z",
      updatedAt: "2026-07-18T02:00:00.000Z",
      ...overrides,
    };
  }

  it("maps an AI draft onto a LINE inbox card", () => {
    const item = toPilotInboxItemFromDraft(draft());
    expect(item.source).toBe("line");
    expect(item.origin).toBe("ai");
    expect(item.confidence).toBe(0.82);
    expect(item.draftId).toBe("90000000-0000-4000-8000-000000000001");
    expect(item.conversationId).toBe("a0000000-0000-4000-8000-000000000001");
    expect(item.draftStatus).toBe("pending_review");
    expect(item.title).toBe("LINE 進件（AI 摘要）");
    expect(item.lockVersion).toBe(3);
    // LINE rows have no phone / service-request status of their own.
    expect(item.contactPhone).toBe("");
    expect(item.status).toBe("new");
    expect(item.referenceNo).toContain("LINE-");
  });

  it("falls back to the summary as the title when no title exists", () => {
    expect(toPilotInboxItemFromDraft(draft({ title: null })).title).toBe(
      "冷氣不冷想約人來看",
    );
  });

  it("falls back to a default title when both title and summary are null", () => {
    const item = toPilotInboxItemFromDraft(draft({ title: null, summary: null }));
    expect(item.title).toBe("LINE 進件");
    expect(item.description).toBe("");
  });

  it("carries a manual (degraded) origin with null confidence", () => {
    const item = toPilotInboxItemFromDraft(
      draft({ origin: "manual", confidence: null, summary: null, title: null }),
    );
    expect(item.origin).toBe("manual");
    expect(item.confidence).toBeNull();
  });
});
