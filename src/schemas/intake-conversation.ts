import { z } from "zod";

// Shapes for the aggregated LINE conversation the extraction worker claims. These
// mirror the jsonb returned by claim_intake_extraction_runs (camelCase keys) so the
// gateway can validate a claim before feeding it to the injected AiExtractor.

export const inboundMessageTypeSchema = z.enum(["text", "image", "sticker", "other"]);
export type InboundMessageType = z.infer<typeof inboundMessageTypeSchema>;

// One message inside a claimed conversation. textContent is null for image/sticker
// messages; sentAt is the LINE-reported send time when present.
export const claimedConversationMessageSchema = z
  .object({
    id: z.uuid(),
    messageType: inboundMessageTypeSchema,
    textContent: z.string().nullable(),
    sentAt: z.iso.datetime({ offset: true }).nullable(),
  })
  .strict();
export type ClaimedConversationMessage = z.infer<typeof claimedConversationMessageSchema>;

// A single claimed conversation: the aggregate root plus its ordered messages.
export const claimedConversationSchema = z
  .object({
    conversationId: z.uuid(),
    organizationId: z.uuid(),
    lineChannelId: z.uuid(),
    lineUserId: z.string().min(1).max(255),
    customerLineIdentityId: z.uuid().nullable(),
    messageCount: z.number().int().min(0),
    claimedBy: z.string().min(1).max(200),
    messages: z.array(claimedConversationMessageSchema).max(2000),
  })
  .strict();
export type ClaimedConversation = z.infer<typeof claimedConversationSchema>;

// claim_intake_extraction_runs returns a jsonb array of claims (or []).
export const claimedConversationsSchema = z.array(claimedConversationSchema);
export type ClaimedConversations = z.infer<typeof claimedConversationsSchema>;
