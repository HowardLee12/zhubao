import { describe, expect, it, vi } from "vitest";

import { getIntakeDraftDetail, listIntakeDrafts } from "./read";

const ORG = "20000000-0000-4000-8000-000000000001";
const DRAFT = "d0000000-0000-4000-8000-000000000001";
const CONV = "c0000000-0000-4000-8000-000000000001";
const MSG = "10000000-0000-4000-8000-000000000001";

// A tiny query-builder stub: each from(table) returns a thenable builder whose chained
// filters are no-ops and which resolves to the row set registered for that table.
function makeClient(tables: Record<string, { data: unknown[] | unknown; error: unknown }>) {
  const schema = () => ({
    from: (table: string) => {
      const result = tables[table] ?? { data: [], error: null };
      const builder: Record<string, unknown> = {};
      const chain = () => builder;
      for (const method of [
        "select",
        "eq",
        "in",
        "order",
        "limit",
      ]) {
        builder[method] = vi.fn(chain);
      }
      builder.maybeSingle = vi.fn(async () => ({
        data: Array.isArray(result.data) ? (result.data[0] ?? null) : result.data,
        error: result.error,
      }));
      // The list queries await the builder directly (no maybeSingle).
      builder.then = (resolve: (v: unknown) => unknown) => resolve(result);
      return builder;
    },
  });
  return { schema } as never;
}

describe("listIntakeDrafts", () => {
  it("shapes drafts + joined conversation into list DTOs", async () => {
    const client = makeClient({
      intake_drafts: {
        data: [
          {
            id: DRAFT,
            conversation_id: CONV,
            status: "pending_review",
            origin: "ai",
            title: "冷氣進件",
            summary: "冷氣不冷",
            confidence: 0.8,
            missing_fields: ["address"],
            lock_version: 2,
            created_at: "2026-07-20T10:00:00.000Z",
            updated_at: "2026-07-20T10:05:00.000Z",
          },
        ],
        error: null,
      },
      conversations: {
        data: [
          {
            id: CONV,
            line_user_id: "Uabc",
            customer_line_identity_id: null,
            message_count: 3,
            last_message_at: "2026-07-20T10:04:00.000Z",
          },
        ],
        error: null,
      },
    });

    const items = await listIntakeDrafts(client, ORG, "pending_review", 50);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: DRAFT,
      source: "line",
      origin: "ai",
      confidence: 0.8,
      lineUserId: "Uabc",
      messageCount: 3,
      missingFields: ["address"],
    });
  });

  it("returns [] when no drafts match", async () => {
    const client = makeClient({ intake_drafts: { data: [], error: null } });
    expect(await listIntakeDrafts(client, ORG, "pending_review", 50)).toEqual([]);
  });

  it("falls back to empty sender fields when the joined conversation is missing", async () => {
    const client = makeClient({
      intake_drafts: {
        data: [
          {
            id: DRAFT,
            conversation_id: CONV,
            status: "pending_review",
            origin: "manual",
            title: null,
            summary: null,
            confidence: null,
            missing_fields: null,
            lock_version: 1,
            created_at: "2026-07-20T10:00:00.000Z",
            updated_at: "2026-07-20T10:05:00.000Z",
          },
        ],
        error: null,
      },
      conversations: { data: [], error: null },
    });

    const items = await listIntakeDrafts(client, ORG, "pending_review", 50);
    expect(items[0]).toMatchObject({
      lineUserId: "",
      messageCount: 0,
      lastMessageAt: null,
      missingFields: [],
    });
  });

  it("throws when the drafts query errors", async () => {
    const client = makeClient({ intake_drafts: { data: null, error: { message: "boom" } } });
    await expect(listIntakeDrafts(client, ORG, "pending_review", 50)).rejects.toBeDefined();
  });

  it("throws when the joined conversations query errors", async () => {
    const client = makeClient({
      intake_drafts: {
        data: [
          {
            id: DRAFT,
            conversation_id: CONV,
            status: "pending_review",
            origin: "ai",
            title: null,
            summary: null,
            confidence: null,
            missing_fields: null,
            lock_version: 1,
            created_at: "2026-07-20T10:00:00.000Z",
            updated_at: "2026-07-20T10:05:00.000Z",
          },
        ],
        error: null,
      },
      conversations: { data: null, error: { message: "conv boom" } },
    });
    await expect(listIntakeDrafts(client, ORG, "pending_review", 50)).rejects.toBeDefined();
  });
});

describe("getIntakeDraftDetail", () => {
  it("assembles a draft with its message timeline + attachments", async () => {
    const client = makeClient({
      intake_drafts: {
        data: {
          id: DRAFT,
          conversation_id: CONV,
          status: "pending_review",
          origin: "ai",
          title: "冷氣進件",
          summary: "冷氣不冷",
          confidence: 0.8,
          fields: { subject: { value: "冷氣", source: "ai", confidence: 0.8 } },
          missing_fields: ["address"],
          converted_service_request_id: null,
          lock_version: 2,
          created_at: "2026-07-20T10:00:00.000Z",
          updated_at: "2026-07-20T10:05:00.000Z",
        },
        error: null,
      },
      conversations: {
        data: {
          id: CONV,
          line_user_id: "Uabc",
          customer_line_identity_id: null,
          message_count: 1,
          last_message_at: "2026-07-20T10:04:00.000Z",
        },
        error: null,
      },
      inbound_messages: {
        data: [
          {
            id: MSG,
            message_type: "image",
            text_content: null,
            sent_at: null,
            received_at: "2026-07-20T10:04:00.000Z",
          },
        ],
        error: null,
      },
      message_attachments: {
        data: [
          {
            id: "a0000000-0000-4000-8000-000000000001",
            inbound_message_id: MSG,
            kind: "image",
            status: "ready",
            storage_path: "org/x/photo.png",
          },
        ],
        error: null,
      },
    });

    const detail = await getIntakeDraftDetail(client, ORG, DRAFT);
    expect(detail).not.toBeNull();
    expect(detail?.fields.subject?.source).toBe("ai");
    expect(detail?.messages).toHaveLength(1);
    expect(detail?.messages[0]?.messageType).toBe("image");
    expect(detail?.messages[0]?.attachments[0]?.storagePath).toBe("org/x/photo.png");
  });

  it("returns null when the draft is not visible", async () => {
    const client = makeClient({ intake_drafts: { data: null, error: null } });
    expect(await getIntakeDraftDetail(client, ORG, DRAFT)).toBeNull();
  });

  function draftRow(overrides: Record<string, unknown> = {}) {
    return {
      id: DRAFT,
      conversation_id: CONV,
      status: "pending_review",
      origin: "ai",
      title: null,
      summary: null,
      confidence: null,
      fields: null,
      missing_fields: null,
      converted_service_request_id: null,
      lock_version: 1,
      created_at: "2026-07-20T10:00:00.000Z",
      updated_at: "2026-07-20T10:05:00.000Z",
      ...overrides,
    };
  }

  it("shapes an empty draft (null fields, no conversation, no messages)", async () => {
    const client = makeClient({
      intake_drafts: { data: draftRow(), error: null },
      conversations: { data: null, error: null },
      inbound_messages: { data: [], error: null },
    });

    const detail = await getIntakeDraftDetail(client, ORG, DRAFT);
    expect(detail).not.toBeNull();
    // parseFields(null) → {}; the attachments query is skipped when there are no messages.
    expect(detail?.fields).toEqual({});
    expect(detail?.lineUserId).toBe("");
    expect(detail?.customerLineIdentityId).toBeNull();
    expect(detail?.missingFields).toEqual([]);
    expect(detail?.messages).toEqual([]);
  });

  it("maps an unknown message type to 'other' and preserves text", async () => {
    const client = makeClient({
      intake_drafts: { data: draftRow(), error: null },
      conversations: { data: null, error: null },
      inbound_messages: {
        data: [
          {
            id: MSG,
            message_type: "video",
            text_content: "watch this",
            sent_at: "2026-07-20T10:03:00.000Z",
            received_at: "2026-07-20T10:04:00.000Z",
          },
        ],
        error: null,
      },
      message_attachments: { data: [], error: null },
    });

    const detail = await getIntakeDraftDetail(client, ORG, DRAFT);
    expect(detail?.messages[0]?.messageType).toBe("other");
    expect(detail?.messages[0]?.text).toBe("watch this");
    expect(detail?.messages[0]?.attachments).toEqual([]);
  });

  it("throws when the draft query errors", async () => {
    const client = makeClient({ intake_drafts: { data: null, error: { message: "draft boom" } } });
    await expect(getIntakeDraftDetail(client, ORG, DRAFT)).rejects.toBeDefined();
  });

  it("throws when the conversation query errors", async () => {
    const client = makeClient({
      intake_drafts: { data: draftRow(), error: null },
      conversations: { data: null, error: { message: "conv boom" } },
    });
    await expect(getIntakeDraftDetail(client, ORG, DRAFT)).rejects.toBeDefined();
  });

  it("throws when the messages query errors", async () => {
    const client = makeClient({
      intake_drafts: { data: draftRow(), error: null },
      conversations: { data: null, error: null },
      inbound_messages: { data: null, error: { message: "msg boom" } },
    });
    await expect(getIntakeDraftDetail(client, ORG, DRAFT)).rejects.toBeDefined();
  });

  it("throws when the attachments query errors", async () => {
    const client = makeClient({
      intake_drafts: { data: draftRow(), error: null },
      conversations: { data: null, error: null },
      inbound_messages: {
        data: [
          {
            id: MSG,
            message_type: "image",
            text_content: null,
            sent_at: null,
            received_at: "2026-07-20T10:04:00.000Z",
          },
        ],
        error: null,
      },
      message_attachments: { data: null, error: { message: "att boom" } },
    });
    await expect(getIntakeDraftDetail(client, ORG, DRAFT)).rejects.toBeDefined();
  });
});
