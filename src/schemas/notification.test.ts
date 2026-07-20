import { describe, expect, it } from "vitest";

import {
  notificationDispatchRequestSchema,
  notificationListQuerySchema,
  notificationViewSchema,
} from "./notification";

describe("notificationListQuerySchema", () => {
  it("accepts an empty query (all filters optional)", () => {
    expect(notificationListQuerySchema.safeParse({}).success).toBe(true);
  });

  it("coerces pageSize from a query string and clamps range", () => {
    const parsed = notificationListQuerySchema.safeParse({ pageSize: "25" });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.pageSize).toBe(25);
    expect(notificationListQuerySchema.safeParse({ pageSize: "0" }).success).toBe(false);
    expect(notificationListQuerySchema.safeParse({ pageSize: "101" }).success).toBe(false);
  });

  it("rejects an unknown status filter", () => {
    expect(notificationListQuerySchema.safeParse({ status: "exploded" }).success).toBe(false);
  });

  it("rejects unknown keys (strict)", () => {
    expect(notificationListQuerySchema.safeParse({ orderBy: "id" }).success).toBe(false);
  });
});

describe("notificationViewSchema", () => {
  const view = {
    id: "88100000-0000-4000-8000-000000000001",
    channel: "line" as const,
    templateKey: "quote_sent",
    templateVersion: 1,
    status: "failed" as const,
    approvalStatus: "not_required" as const,
    attemptCount: 1,
    maxAttempts: 5,
    lastErrorCode: "RATE_LIMITED",
    hasProviderMessage: false,
    relatedType: "quote" as const,
    relatedId: "77700000-0000-4000-8000-000000000001",
    scheduledAt: "2026-07-20T00:00:00+00:00",
    nextAttemptAt: "2026-07-20T00:01:00+00:00",
    sentAt: null,
    failedAt: null,
    cancelledAt: null,
    createdAt: "2026-07-20T00:00:00+00:00",
  };

  it("accepts a redacted view", () => {
    expect(notificationViewSchema.safeParse(view).success).toBe(true);
  });

  it("rejects a view carrying a raw provider_message_id field", () => {
    expect(
      notificationViewSchema.safeParse({ ...view, providerMessageId: "line-msg-1" }).success,
    ).toBe(false);
  });

  it("rejects a view carrying the payload", () => {
    expect(notificationViewSchema.safeParse({ ...view, payload: { text: "hi" } }).success).toBe(
      false,
    );
  });
});

describe("notificationDispatchRequestSchema", () => {
  it("accepts an empty body (limit defaults downstream)", () => {
    expect(notificationDispatchRequestSchema.safeParse({}).success).toBe(true);
  });

  it("clamps limit to 1..50", () => {
    expect(notificationDispatchRequestSchema.safeParse({ limit: 51 }).success).toBe(false);
    expect(notificationDispatchRequestSchema.safeParse({ limit: 0 }).success).toBe(false);
    expect(notificationDispatchRequestSchema.safeParse({ limit: 50 }).success).toBe(true);
  });
});
