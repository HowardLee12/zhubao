import type { SupabaseClient } from "@supabase/supabase-js";

import {
  extractionFieldsSchema,
  type ExtractionFields,
} from "@/schemas/ai-extraction";
import type {
  IntakeDraftDetail,
  IntakeDraftListItem,
  IntakeDraftMessage,
} from "@/schemas/intake-draft";

// Staff read path for the intake-draft inbox. All queries run through the caller's
// RLS-scoped authenticated client (owner/admin/dispatcher SELECT policy from the
// migration), so tenant isolation and role gating are enforced by the database — this
// module only shapes rows into DTOs. Media is referenced by its private storage path;
// a signed URL is minted separately and never exposed publicly.

type PublicClient = Pick<SupabaseClient, "schema">;

// The status filter accepted by the list route (pending_review is the inbox default).
export type IntakeDraftListStatus = "pending_review" | "confirmed" | "dismissed" | "superseded";

interface DraftRow {
  id: string;
  conversation_id: string;
  status: string;
  origin: string;
  title: string | null;
  summary: string | null;
  confidence: number | null;
  fields: unknown;
  missing_fields: string[] | null;
  converted_service_request_id: string | null;
  lock_version: number;
  created_at: string;
  updated_at: string;
}

interface ConversationRow {
  id: string;
  line_user_id: string;
  customer_line_identity_id: string | null;
  message_count: number;
  last_message_at: string | null;
}

interface MessageRow {
  id: string;
  message_type: string;
  text_content: string | null;
  sent_at: string | null;
  received_at: string;
}

interface AttachmentRow {
  id: string;
  inbound_message_id: string;
  kind: string;
  status: string;
  storage_path: string | null;
}

function parseFields(raw: unknown): ExtractionFields {
  const parsed = extractionFieldsSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : {};
}

function toMessageType(value: string): IntakeDraftMessage["messageType"] {
  return value === "text" || value === "image" || value === "sticker" ? value : "other";
}

// List the intake drafts for an org, newest-first, filtered by status. RLS scopes the
// rows to the caller's org and role. Conversations are joined in a second query so the
// list card can show sender + message count without a DB view.
export async function listIntakeDrafts(
  supabase: PublicClient,
  organizationId: string,
  status: IntakeDraftListStatus,
  limit: number,
): Promise<IntakeDraftListItem[]> {
  const draftsResult = await supabase
    .schema("public")
    .from("intake_drafts")
    .select(
      "id, conversation_id, status, origin, title, summary, confidence, missing_fields, lock_version, created_at, updated_at",
    )
    .eq("organization_id", organizationId)
    .eq("status", status)
    .order("updated_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit);
  if (draftsResult.error) throw draftsResult.error;
  const drafts = (draftsResult.data ?? []) as DraftRow[];
  if (drafts.length === 0) return [];

  const conversationIds = [...new Set(drafts.map((d) => d.conversation_id))];
  const conversationsResult = await supabase
    .schema("public")
    .from("conversations")
    .select("id, line_user_id, customer_line_identity_id, message_count, last_message_at")
    .eq("organization_id", organizationId)
    .in("id", conversationIds);
  if (conversationsResult.error) throw conversationsResult.error;
  const byConversation = new Map(
    ((conversationsResult.data ?? []) as ConversationRow[]).map((c) => [c.id, c]),
  );

  return drafts.map((draft) => {
    const conversation = byConversation.get(draft.conversation_id);
    return {
      id: draft.id,
      conversationId: draft.conversation_id,
      status: draft.status as IntakeDraftListItem["status"],
      origin: draft.origin as IntakeDraftListItem["origin"],
      source: "line" as const,
      title: draft.title,
      summary: draft.summary,
      confidence: draft.confidence,
      missingFields: draft.missing_fields ?? [],
      lineUserId: conversation?.line_user_id ?? "",
      messageCount: conversation?.message_count ?? 0,
      lastMessageAt: conversation?.last_message_at ?? null,
      lockVersion: draft.lock_version,
      createdAt: draft.created_at,
      updatedAt: draft.updated_at,
    };
  });
}

// Load one draft with its conversation, the immutable original-message timeline, and
// each message's image attachments (by storage path). Returns null when the draft is
// not visible to the caller (RLS) or does not exist.
export async function getIntakeDraftDetail(
  supabase: PublicClient,
  organizationId: string,
  draftId: string,
): Promise<IntakeDraftDetail | null> {
  const draftResult = await supabase
    .schema("public")
    .from("intake_drafts")
    .select(
      "id, conversation_id, status, origin, title, summary, confidence, fields, missing_fields, converted_service_request_id, lock_version, created_at, updated_at",
    )
    .eq("organization_id", organizationId)
    .eq("id", draftId)
    .maybeSingle();
  if (draftResult.error) throw draftResult.error;
  if (!draftResult.data) return null;
  const draft = draftResult.data as DraftRow;

  const conversationResult = await supabase
    .schema("public")
    .from("conversations")
    .select("id, line_user_id, customer_line_identity_id, message_count, last_message_at")
    .eq("organization_id", organizationId)
    .eq("id", draft.conversation_id)
    .maybeSingle();
  if (conversationResult.error) throw conversationResult.error;
  const conversation = conversationResult.data as ConversationRow | null;

  const messagesResult = await supabase
    .schema("public")
    .from("inbound_messages")
    .select("id, message_type, text_content, sent_at, received_at")
    .eq("organization_id", organizationId)
    .eq("conversation_id", draft.conversation_id)
    .order("received_at", { ascending: true })
    .order("id", { ascending: true });
  if (messagesResult.error) throw messagesResult.error;
  const messages = (messagesResult.data ?? []) as MessageRow[];

  const messageIds = messages.map((m) => m.id);
  let attachments: AttachmentRow[] = [];
  if (messageIds.length > 0) {
    const attachmentsResult = await supabase
      .schema("public")
      .from("message_attachments")
      .select("id, inbound_message_id, kind, status, storage_path")
      .eq("organization_id", organizationId)
      .in("inbound_message_id", messageIds);
    if (attachmentsResult.error) throw attachmentsResult.error;
    attachments = (attachmentsResult.data ?? []) as AttachmentRow[];
  }
  const attachmentsByMessage = new Map<string, AttachmentRow[]>();
  for (const attachment of attachments) {
    const list = attachmentsByMessage.get(attachment.inbound_message_id) ?? [];
    list.push(attachment);
    attachmentsByMessage.set(attachment.inbound_message_id, list);
  }

  const timeline: IntakeDraftMessage[] = messages.map((message) => ({
    id: message.id,
    messageType: toMessageType(message.message_type),
    text: message.text_content,
    sentAt: message.sent_at,
    receivedAt: message.received_at,
    attachments: (attachmentsByMessage.get(message.id) ?? []).map((attachment) => ({
      id: attachment.id,
      kind: "image" as const,
      status: attachment.status,
      storagePath: attachment.storage_path,
    })),
  }));

  return {
    id: draft.id,
    conversationId: draft.conversation_id,
    status: draft.status as IntakeDraftDetail["status"],
    origin: draft.origin as IntakeDraftDetail["origin"],
    source: "line" as const,
    title: draft.title,
    summary: draft.summary,
    confidence: draft.confidence,
    fields: parseFields(draft.fields),
    missingFields: draft.missing_fields ?? [],
    lineUserId: conversation?.line_user_id ?? "",
    customerLineIdentityId: conversation?.customer_line_identity_id ?? null,
    convertedServiceRequestId: draft.converted_service_request_id,
    lockVersion: draft.lock_version,
    createdAt: draft.created_at,
    updatedAt: draft.updated_at,
    messages: timeline,
  };
}
