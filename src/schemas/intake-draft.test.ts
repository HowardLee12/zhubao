import { describe, expect, it } from "vitest";

import {
  confirmIntakeDraftEnvelopeSchema,
  confirmIntakeDraftRequestSchema,
  dismissIntakeDraftRequestSchema,
  intakeDraftDetailSchema,
  intakeDraftListItemSchema,
} from "./intake-draft";

const iso = "2026-07-20T10:00:00.000Z";
const uuid = "d0000000-0000-4000-8000-000000000001";

describe("intakeDraftListItemSchema", () => {
  it("accepts a well-formed AI draft card", () => {
    const parsed = intakeDraftListItemSchema.parse({
      id: uuid,
      conversationId: uuid,
      status: "pending_review",
      origin: "ai",
      source: "line",
      title: "t",
      summary: "s",
      confidence: 0.8,
      missingFields: ["address"],
      lineUserId: "Uabc",
      messageCount: 2,
      lastMessageAt: iso,
      lockVersion: 1,
      createdAt: iso,
      updatedAt: iso,
    });
    expect(parsed.origin).toBe("ai");
  });

  it("rejects a non-line source", () => {
    expect(() =>
      intakeDraftListItemSchema.parse({
        id: uuid,
        conversationId: uuid,
        status: "pending_review",
        origin: "manual",
        source: "web",
        title: null,
        summary: null,
        confidence: null,
        missingFields: [],
        lineUserId: "U",
        messageCount: 0,
        lastMessageAt: null,
        lockVersion: 1,
        createdAt: iso,
        updatedAt: iso,
      }),
    ).toThrow();
  });
});

describe("intakeDraftDetailSchema", () => {
  it("accepts a detail with per-field provenance and a message timeline", () => {
    const parsed = intakeDraftDetailSchema.parse({
      id: uuid,
      conversationId: uuid,
      status: "pending_review",
      origin: "manual",
      source: "line",
      title: null,
      summary: null,
      confidence: null,
      fields: { subject: { value: "冷氣", source: "line", confidence: null } },
      missingFields: [],
      lineUserId: "Uabc",
      customerLineIdentityId: null,
      convertedServiceRequestId: null,
      lockVersion: 1,
      createdAt: iso,
      updatedAt: iso,
      messages: [
        {
          id: uuid,
          messageType: "text",
          text: "冷氣不冷",
          sentAt: null,
          receivedAt: iso,
          attachments: [],
        },
      ],
    });
    expect(parsed.fields.subject?.source).toBe("line");
  });
});

describe("confirm/dismiss request + envelope schemas", () => {
  it("confirm request allows optional field overrides", () => {
    expect(confirmIntakeDraftRequestSchema.parse({})).toEqual({});
    const withOverrides = confirmIntakeDraftRequestSchema.parse({
      fieldOverrides: { contactName: { value: "王先生", source: "manual", confidence: null } },
    });
    expect(withOverrides.fieldOverrides?.contactName?.value).toBe("王先生");
  });

  it("confirm envelope validates the RPC return shape", () => {
    const parsed = confirmIntakeDraftEnvelopeSchema.parse({
      serviceRequestId: uuid,
      requestNo: "SR-202607-000001",
      draftId: uuid,
      draftStatus: "confirmed",
      status: "new",
      replayed: false,
    });
    expect(parsed.replayed).toBe(false);
  });

  it("dismiss request allows an optional reason", () => {
    expect(dismissIntakeDraftRequestSchema.parse({ reason: "spam" }).reason).toBe("spam");
    expect(dismissIntakeDraftRequestSchema.parse({})).toEqual({});
  });
});
