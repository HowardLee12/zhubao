import { describe, expect, it } from "vitest";

import { claimedConversationsSchema } from "./intake-conversation";

const uuid = "c0000000-0000-4000-8000-000000000001";
const msgId = "10000000-0000-4000-8000-000000000001";

describe("claimedConversationsSchema", () => {
  it("parses a claim array from claim_intake_extraction_runs", () => {
    const parsed = claimedConversationsSchema.parse([
      {
        conversationId: uuid,
        organizationId: "20000000-0000-4000-8000-000000000001",
        lineChannelId: "a1c00000-0000-4000-8000-000000000001",
        lineUserId: "Uabc",
        customerLineIdentityId: null,
        messageCount: 1,
        claimedBy: "w",
        messages: [{ id: msgId, messageType: "text", textContent: "hi", sentAt: null }],
      },
    ]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.messages[0]?.messageType).toBe("text");
  });

  it("accepts the empty claim result", () => {
    expect(claimedConversationsSchema.parse([])).toEqual([]);
  });

  it("rejects an unknown message type", () => {
    expect(() =>
      claimedConversationsSchema.parse([
        {
          conversationId: uuid,
          organizationId: "20000000-0000-4000-8000-000000000001",
          lineChannelId: "a1c00000-0000-4000-8000-000000000001",
          lineUserId: "Uabc",
          customerLineIdentityId: null,
          messageCount: 1,
          claimedBy: "w",
          messages: [{ id: msgId, messageType: "video", textContent: null, sentAt: null }],
        },
      ]),
    ).toThrow();
  });
});
