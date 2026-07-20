import { createHash } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { lineWebhookBodySchema } from "@/schemas/line-webhook";
import { internalApiProblem } from "@/server/supabase/http";
import {
  decideWebhookApply,
  type FriendStatus,
} from "./webhook-handler";

type Rpc = Pick<SupabaseClient, "rpc">;

// SHA-256 of the raw webhook bytes, lowercase hex. This is the fallback dedupe key
// (used when a redelivery omits webhookEventId) and satisfies the table's
// ^[0-9a-f]{64}$ CHECK. Computed over the exact bytes the signature verified.
export function computePayloadSha256(rawBody: Uint8Array): string {
  return createHash("sha256").update(Buffer.from(rawBody)).digest("hex");
}

function rpcError(): never {
  throw internalApiProblem();
}

export interface IngestInput {
  supabase: Rpc;
  channelId: string;
  rawBody: Uint8Array;
}

export interface IngestSummary {
  ingested: number;
  duplicate: number;
}

// Insert-only landing of each event in a delivery. The whole batch shares one
// payload_sha256 (LINE signs the batch); per-event identity comes from
// webhookEventId when present. Duplicates are expected (LINE retries) and counted,
// not errored — the route returns 200 for both new and duplicate.
export async function ingestWebhookEvents(input: IngestInput): Promise<IngestSummary> {
  const parsed = lineWebhookBodySchema.parse(JSON.parse(Buffer.from(input.rawBody).toString("utf8")));
  const sha256 = computePayloadSha256(input.rawBody);
  const summary: IngestSummary = { ingested: 0, duplicate: 0 };

  for (const event of parsed.events) {
    const eventTimestamp = new Date(event.timestamp).toISOString();
    const { data, error } = await input.supabase.rpc("ingest_line_webhook_event", {
      p_channel_id: input.channelId,
      p_webhook_event_id: event.webhookEventId ?? null,
      p_event_type: event.type,
      p_event_timestamp: eventTimestamp,
      p_payload: event,
      p_payload_sha256: sha256,
    });
    if (error) rpcError();
    const result = data as { duplicate?: boolean } | null;
    if (result?.duplicate) summary.duplicate += 1;
    else summary.ingested += 1;
  }

  return summary;
}

export interface ClaimedWebhookEvent {
  id: string;
  organizationId: string;
  lineChannelId: string;
  webhookEventId: string | null;
  eventType: string;
  eventTimestamp: string;
  payload: Record<string, unknown>;
  attemptCount: number;
}

export interface WebhookProcessFacts {
  currentFriendStatus: FriendStatus;
  lastAppliedTimestamp: string | null;
}

export interface ProcessInput {
  supabase: Rpc;
  workerId: string;
  limit?: number;
  now?: string;
  // Loads the current friend state for the event's LINE identity. Injected so the
  // pure ordering decision (decideWebhookApply) can be tested without a DB.
  resolveFacts: (event: ClaimedWebhookEvent) => Promise<WebhookProcessFacts>;
  // Applies a follow/unfollow state change (idempotent upsert) AND advances the
  // ordering watermark (last_event_at) to this event's timestamp. Injected seam.
  applyFollowChange: (
    event: ClaimedWebhookEvent,
    nextFriendStatus: FriendStatus,
  ) => Promise<void>;
  // Advances the ordering watermark (last_event_at) WITHOUT changing friend_status.
  // Called for a no_state_change ignore so a redelivered/duplicate follow still
  // moves the watermark forward — otherwise a later out-of-order unfollow whose
  // timestamp sits between the applied change and the ignored one would wrongly
  // win. Injected seam; a no-op is acceptable when the identity is unknown.
  advanceWatermark: (event: ClaimedWebhookEvent) => Promise<void>;
}

export interface ProcessSummary {
  claimed: number;
  processed: number;
  ignored: number;
  failed: number;
}

async function claim(input: ProcessInput): Promise<ClaimedWebhookEvent[]> {
  const { data, error } = await input.supabase.rpc("claim_line_webhook_events", {
    p_worker_id: input.workerId,
    p_limit: input.limit ?? 10,
    p_now: input.now ?? null,
  });
  if (error) rpcError();
  if (!Array.isArray(data)) rpcError();
  return data as ClaimedWebhookEvent[];
}

async function mark(input: ProcessInput, fn: string, id: string, note: string | null): Promise<void> {
  const { error } = await input.supabase.rpc(fn, { p_event_id: id, p_note: note });
  if (error) rpcError();
}

async function markFailed(input: ProcessInput, id: string, code: string): Promise<void> {
  const { error } = await input.supabase.rpc("mark_webhook_failed", {
    p_event_id: id,
    p_error_code: code,
  });
  if (error) rpcError();
}

// One process pass over claimed webhook rows. The out-of-order gate (decideWebhookApply)
// decides apply vs ignore purely from timestamp + state; an apply that throws is marked
// failed (re-claimable via backoff), everything else is processed/ignored terminally.
export async function processClaimedWebhookEvents(input: ProcessInput): Promise<ProcessSummary> {
  const rows = await claim(input);
  const summary: ProcessSummary = {
    claimed: rows.length,
    processed: 0,
    ignored: 0,
    failed: 0,
  };

  for (const event of rows) {
    try {
      const facts = await input.resolveFacts(event);
      const decision = decideWebhookApply({
        eventType: event.eventType,
        eventTimestamp: event.eventTimestamp,
        currentFriendStatus: facts.currentFriendStatus,
        lastAppliedTimestamp: facts.lastAppliedTimestamp,
      });

      if (decision.action === "ignore") {
        // A no_state_change ignore is still a real, newer follow/unfollow signal:
        // advance the watermark so it participates in ordering. Any other ignore
        // reason (unhandled type, invalid/stale timestamp) must NOT move it.
        if (decision.reason === "no_state_change") {
          await input.advanceWatermark(event);
        }
        await mark(input, "mark_webhook_ignored", event.id, decision.reason);
        summary.ignored += 1;
        continue;
      }

      await input.applyFollowChange(event, decision.nextFriendStatus);
      await mark(input, "mark_webhook_processed", event.id, null);
      summary.processed += 1;
    } catch {
      await markFailed(input, event.id, "WEBHOOK_PROCESS_ERROR");
      summary.failed += 1;
    }
  }

  return summary;
}
