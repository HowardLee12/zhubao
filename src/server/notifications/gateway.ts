import type { SupabaseClient } from "@supabase/supabase-js";

import {
  classifyPushFailure,
  type LineMessenger,
  type PushMessageResult,
} from "@/server/integrations/line/client";
import {
  isKnownTemplateKey,
  renderLineTemplate,
  type TemplateVars,
} from "@/server/integrations/line/templates";
import { internalApiProblem } from "@/server/supabase/http";

type Rpc = Pick<SupabaseClient, "rpc">;

// A row returned by claim_notifications (already moved to `processing`). The gateway
// never reads the DB directly — it composes the M6 RPCs so the same code runs in
// tests (injected rpc stub + FakeLineMessenger) and in the worker route (admin
// client + factory-selected messenger).
export interface ClaimedNotification {
  id: string;
  organizationId: string;
  channel: string;
  lineChannelId: string | null;
  customerLineIdentityId: string | null;
  membershipId: string | null;
  templateKey: string;
  templateVersion: number;
  payload: Record<string, unknown>;
  attemptCount: number;
  maxAttempts: number;
  dedupeKey: string;
  relatedType: string | null;
  relatedId: string | null;
}

export interface EnqueueNotificationInput {
  organizationId: string;
  channel: string;
  lineChannelId: string | null;
  templateKey: string;
  templateVersion: number;
  payload: Record<string, unknown>;
  dedupeKey: string;
  relatedType: string | null;
  relatedId: string | null;
  customerLineIdentityId?: string | null;
  membershipId?: string | null;
  approvalStatus?: string;
  scheduledAt?: string | null;
}

export interface EnqueueResult {
  enqueued: boolean;
  notificationId: string | null;
  status: string;
}

function rpcError(): never {
  throw internalApiProblem();
}

// Thin wrapper over the internal enqueue RPC. In production this is invoked inside
// the same transaction as the triggering mutation (Wave C wires PERFORM in SQL); the
// TS wrapper exists for tests and for any app-side enqueue that runs its own txn.
export async function enqueueNotification(
  supabase: Rpc,
  input: EnqueueNotificationInput,
): Promise<EnqueueResult> {
  const { data, error } = await supabase.rpc("enqueue_notification", {
    target_org: input.organizationId,
    p_channel: input.channel,
    p_line_channel_id: input.lineChannelId,
    p_template_key: input.templateKey,
    p_template_version: input.templateVersion,
    p_payload: input.payload,
    p_dedupe_key: input.dedupeKey,
    p_related_type: input.relatedType,
    p_related_id: input.relatedId,
    p_customer_line_identity_id: input.customerLineIdentityId ?? null,
    p_membership_id: input.membershipId ?? null,
    p_approval_status: input.approvalStatus ?? "not_required",
    p_scheduled_at: input.scheduledAt ?? null,
  });
  if (error) rpcError();
  const envelope = data as EnqueueResult | null;
  if (!envelope || typeof envelope.enqueued !== "boolean") rpcError();
  return envelope;
}

// Resolves a claimed row to its concrete send target (LINE user id + decrypted
// access token). Returning null means "cannot deliver" (e.g. missing identity or
// credential) — the row is failed permanently rather than retried forever.
export type ResolveTarget = (
  row: ClaimedNotification,
) => Promise<{ to: string; accessToken: string } | null>;

export interface DispatchSummary {
  claimed: number;
  sent: number;
  retried: number;
  failed: number;
  skipped: number;
}

export interface DispatchInput {
  supabase: Rpc;
  messenger: LineMessenger;
  resolveTarget: ResolveTarget;
  workerId: string;
  limit?: number;
  now?: string;
}

async function claim(input: DispatchInput): Promise<ClaimedNotification[]> {
  const { data, error } = await input.supabase.rpc("claim_notifications", {
    p_worker_id: input.workerId,
    p_limit: input.limit ?? 10,
    p_now: input.now ?? null,
  });
  if (error) rpcError();
  if (!Array.isArray(data)) rpcError();
  return data as ClaimedNotification[];
}

async function markSent(
  input: DispatchInput,
  id: string,
  result: Extract<PushMessageResult, { status: "sent" }>,
): Promise<void> {
  const { error } = await input.supabase.rpc("mark_notification_sent", {
    p_notification_id: id,
    p_provider_message_id: result.providerMessageId,
  });
  if (error) rpcError();
}

async function markRetry(input: DispatchInput, id: string, errorCode: string): Promise<void> {
  const { error } = await input.supabase.rpc("mark_notification_retry", {
    p_notification_id: id,
    p_error_code: errorCode,
    p_now: input.now ?? null,
  });
  if (error) rpcError();
}

async function markFailed(input: DispatchInput, id: string, errorCode: string): Promise<void> {
  const { error } = await input.supabase.rpc("mark_notification_failed", {
    p_notification_id: id,
    p_error_code: errorCode,
  });
  if (error) rpcError();
}

// One dispatch pass: claim a batch, send each through the injected messenger, and
// map the provider result to the DB state machine. `retriable` -> retry (DB schedules
// full-jitter backoff); `permanent` (4xx) or an undeliverable target -> failed.
export async function dispatchClaimedNotifications(
  input: DispatchInput,
): Promise<DispatchSummary> {
  const rows = await claim(input);
  const summary: DispatchSummary = {
    claimed: rows.length,
    sent: 0,
    retried: 0,
    failed: 0,
    skipped: 0,
  };

  for (const row of rows) {
    if (row.channel !== "line" || !isKnownTemplateKey(row.templateKey)) {
      await markFailed(input, row.id, "UNSUPPORTED_CHANNEL_OR_TEMPLATE");
      summary.skipped += 1;
      summary.failed += 1;
      continue;
    }

    const target = await input.resolveTarget(row);
    if (!target) {
      await markFailed(input, row.id, "RECIPIENT_UNRESOLVED");
      summary.skipped += 1;
      summary.failed += 1;
      continue;
    }

    const messages = renderLineTemplate(row.templateKey, row.payload as TemplateVars);
    const result = await input.messenger.pushMessage({
      lineChannelId: row.lineChannelId ?? "",
      accessToken: target.accessToken,
      to: target.to,
      messages,
    });

    if (result.status === "sent") {
      await markSent(input, row.id, result);
      summary.sent += 1;
      continue;
    }

    if (classifyPushFailure(result) === "retriable") {
      await markRetry(input, row.id, result.errorCode);
      summary.retried += 1;
    } else {
      await markFailed(input, row.id, result.errorCode);
      summary.failed += 1;
    }
  }

  return summary;
}
