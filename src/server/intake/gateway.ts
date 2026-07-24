import type { SupabaseClient } from "@supabase/supabase-js";

import {
  claimedConversationsSchema,
  type ClaimedConversation,
} from "@/schemas/intake-conversation";
import { extractionResultSchema } from "@/schemas/ai-extraction";
import type { AiExtractor, ExtractionInput } from "@/server/integrations/ai/extractor";
import { internalApiProblem } from "@/server/supabase/http";

type Rpc = Pick<SupabaseClient, "rpc">;

function rpcError(): never {
  throw internalApiProblem();
}

// Cap the audit error code to the DB column limit (1..120 chars) so a long thrown
// message never breaks the failed run insert.
function toErrorCode(error: unknown): string {
  const raw = error instanceof Error ? error.message : "EXTRACTION_ERROR";
  const trimmed = raw.trim().slice(0, 120);
  return trimmed.length > 0 ? trimmed : "EXTRACTION_ERROR";
}

// Build the extractor input from a claimed conversation: concatenate the text
// messages (in order) as the conversation text, list the image messages as
// attachment descriptors, and pass every message id so the run audit records exactly
// what was read.
function toExtractionInput(conversation: ClaimedConversation): ExtractionInput {
  const conversationText = conversation.messages
    .map((m) => m.textContent?.trim())
    .filter((t): t is string => Boolean(t && t.length > 0))
    .join("\n")
    .slice(0, 40000);

  const attachments = conversation.messages
    .filter((m) => m.messageType === "image")
    .map((m) => ({ messageId: m.id, kind: "image" as const, storagePath: null }));

  return {
    conversationText,
    attachments: attachments.length > 0 ? attachments : undefined,
    messageIds: conversation.messages.map((m) => m.id),
  };
}

export interface ExtractionInputBundle {
  supabase: Rpc;
  extractor: AiExtractor;
  workerId: string;
  limit?: number;
  now?: string;
}

export interface ExtractionSummary {
  claimed: number;
  succeeded: number;
  degraded: number;
}

async function claim(input: ExtractionInputBundle): Promise<ClaimedConversation[]> {
  const { data, error } = await input.supabase.rpc("claim_intake_extraction_runs", {
    p_worker_id: input.workerId,
    p_limit: input.limit ?? 10,
    p_now: input.now ?? null,
  });
  if (error) rpcError();
  const parsed = claimedConversationsSchema.safeParse(data);
  if (!parsed.success) rpcError();
  return parsed.data;
}

async function markSucceeded(
  input: ExtractionInputBundle,
  conversation: ClaimedConversation,
  result: ReturnType<typeof extractionResultSchema.parse>,
  latencyMs: number,
): Promise<void> {
  const { error } = await input.supabase.rpc("mark_extraction_succeeded", {
    p_org: conversation.organizationId,
    p_conversation_id: conversation.conversationId,
    p_extractor_name: "fake",
    p_input_message_ids: result.usedMessageIds,
    p_confidence: result.overallConfidence,
    p_summary: result.summary,
    p_title: result.title,
    p_fields: result.fields,
    p_missing_fields: result.missingFields,
    p_model_version: null,
    p_output: null,
    p_latency_ms: latencyMs,
  });
  if (error) rpcError();
}

async function markFailed(
  input: ExtractionInputBundle,
  conversation: ClaimedConversation,
  errorCode: string,
  latencyMs: number,
): Promise<void> {
  const { error } = await input.supabase.rpc("mark_extraction_failed", {
    p_org: conversation.organizationId,
    p_conversation_id: conversation.conversationId,
    p_extractor_name: "fake",
    p_input_message_ids: conversation.messages.map((m) => m.id),
    p_error_code: errorCode,
    p_latency_ms: latencyMs,
  });
  if (error) rpcError();
}

// One extraction pass. The gateway is the DEGRADATION BOUNDARY: it claims open
// conversations, runs each through the injected AiExtractor, and maps the outcome to
// the DB. A successful, schema-valid result writes an AI draft (mark_extraction_succeeded).
// ANY failure — the extractor throwing, or returning something that violates the seam
// contract — is caught and downgraded to a manual draft (mark_extraction_failed), which
// the DB guarantees still yields a pending_review draft. This function therefore NEVER
// throws past its own boundary for an extraction failure (only an infra/RPC error, which
// re-claims the conversation next pass). AI failure must never block intake.
export async function runClaimedExtractions(
  input: ExtractionInputBundle,
): Promise<ExtractionSummary> {
  const conversations = await claim(input);
  const summary: ExtractionSummary = {
    claimed: conversations.length,
    succeeded: 0,
    degraded: 0,
  };

  for (const conversation of conversations) {
    const startedAt = Date.now();
    try {
      const raw = await input.extractor.extractIntake(toExtractionInput(conversation));
      // Validate at the boundary: a malformed model response degrades exactly like a
      // thrown error rather than persisting a bad draft.
      const result = extractionResultSchema.parse(raw);
      await markSucceeded(input, conversation, result, Date.now() - startedAt);
      summary.succeeded += 1;
    } catch (error) {
      // Degradation gate: never let an AI failure block intake. The failed run writes
      // an origin='manual' draft so the inbound message is preserved for a human.
      await markFailed(input, conversation, toErrorCode(error), Date.now() - startedAt);
      summary.degraded += 1;
    }
  }

  return summary;
}
