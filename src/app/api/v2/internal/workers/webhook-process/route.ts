import { assertWorkerAuthorized } from "@/server/api/worker-auth";
import {
  processClaimedWebhookEvents,
  type ClaimedWebhookEvent,
  type WebhookProcessFacts,
} from "@/server/integrations/line/webhook-gateway";
import type { FriendStatus } from "@/server/integrations/line/webhook-handler";
import { createAdminSupabaseClient } from "@/server/supabase/admin";
import { ApiProblem } from "@/server/api/problem";
import { resolveRequestId } from "@/server/api/request";
import { apiJsonResponse, apiProblemResponse, internalApiProblem } from "@/server/supabase/http";

// Internal webhook-process worker. Guarded ONLY by WORKER_SECRET. Claims durable
// inbox rows and applies the pure out-of-order decision (亂序 gate): a follow /
// unfollow updates the matching customer LINE identity's friend_status ONLY when
// it is strictly newer than the last applied change; anything stale/unhandled is
// marked ignored. An identity we do not know about is a no-op (still processed) —
// M6 does not synthesize customers from inbound events (that is M7's intake model).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AdminClient = ReturnType<typeof createAdminSupabaseClient>;

// The LINE user id lives at payload.source.userId on follow/unfollow events.
function lineUserIdOf(event: ClaimedWebhookEvent): string | null {
  const source = (event.payload as { source?: { userId?: unknown } }).source;
  const userId = source?.userId;
  return typeof userId === "string" && userId.length > 0 ? userId : null;
}

function friendStatusFromRow(row: {
  friend_status: string;
  followed_at: string | null;
  unfollowed_at: string | null;
  last_event_at: string | null;
}): { status: FriendStatus; lastApplied: string | null } {
  const status = (["unknown", "friend", "blocked", "unfollowed"] as const).includes(
    row.friend_status as FriendStatus,
  )
    ? (row.friend_status as FriendStatus)
    : "unknown";
  // The ordering watermark is the true last-SEEN follow/unfollow (last_event_at),
  // which advances on apply AND on a no_state_change ignore — NOT max(followed_at,
  // unfollowed_at), which only moves on an apply and would let a stale out-of-order
  // event slip past a newer-but-idempotent follow. Fall back to the apply columns
  // for legacy rows written before last_event_at existed / was backfilled.
  const applyCandidates = [row.followed_at, row.unfollowed_at].filter(
    (value): value is string => value !== null,
  );
  const fallback =
    applyCandidates.length > 0
      ? applyCandidates.reduce((a, b) => (Date.parse(a) >= Date.parse(b) ? a : b))
      : null;
  const lastApplied = row.last_event_at ?? fallback;
  return { status, lastApplied };
}

async function loadIdentity(
  supabase: AdminClient,
  event: ClaimedWebhookEvent,
): Promise<{ id: string; facts: WebhookProcessFacts } | null> {
  const userId = lineUserIdOf(event);
  if (!userId) return null;
  const result = await supabase
    .schema("public")
    .from("customer_line_identities")
    .select("id, friend_status, followed_at, unfollowed_at, last_event_at")
    .eq("line_channel_id", event.lineChannelId)
    .eq("line_user_id", userId)
    .maybeSingle();
  if (result.error || !result.data) return null;
  const row = result.data as {
    id: string;
    friend_status: string;
    followed_at: string | null;
    unfollowed_at: string | null;
    last_event_at: string | null;
  };
  const derived = friendStatusFromRow(row);
  return {
    id: row.id,
    facts: { currentFriendStatus: derived.status, lastAppliedTimestamp: derived.lastApplied },
  };
}

// Single write path for a terminally-processed follow/unfollow. A non-null
// nextFriendStatus is an apply (status + apply column + watermark); null is a
// no_state_change ignore (watermark only). An unknown identity is an inert no-op.
async function writeIdentityEvent(
  supabase: AdminClient,
  event: ClaimedWebhookEvent,
  nextFriendStatus: FriendStatus | null,
): Promise<void> {
  const identity = await loadIdentity(supabase, event);
  if (!identity) return;
  const applied = await supabase.rpc("apply_line_identity_event", {
    p_identity_id: identity.id,
    p_event_timestamp: event.eventTimestamp,
    p_next_friend_status: nextFriendStatus,
  });
  if (applied.error) throw applied.error;
}

export async function POST(request: Request): Promise<Response> {
  const requestId = resolveRequestId(request.headers.get("x-request-id"));

  try {
    assertWorkerAuthorized(request);

    const supabase = createAdminSupabaseClient();

    const summary = await processClaimedWebhookEvents({
      supabase,
      workerId: `webhook-process:${requestId}`,
      // Resolve the current friend state for the event's LINE identity. An unknown
      // identity resolves to unknown/null so the pure decision still runs and the
      // event is processed (no domain change) rather than failing forever.
      resolveFacts: async (event) => {
        const identity = await loadIdentity(supabase, event);
        return (
          identity?.facts ?? { currentFriendStatus: "unknown", lastAppliedTimestamp: null }
        );
      },
      // Apply the follow/unfollow state change idempotently AND advance the
      // ordering watermark (last_event_at). Only a known identity is written; an
      // unknown user id is a durable-but-inert receipt. The RPC is the single
      // write path so friend_status + apply columns + watermark move atomically.
      applyFollowChange: async (event, nextFriendStatus) => {
        await writeIdentityEvent(supabase, event, nextFriendStatus);
      },
      // A no_state_change ignore is still a newer real signal: advance the
      // watermark only (no friend_status change) so a later out-of-order
      // follow/unfollow whose timestamp predates it is correctly rejected.
      advanceWatermark: async (event) => {
        await writeIdentityEvent(supabase, event, null);
      },
    });

    return apiJsonResponse({ data: summary }, { requestId });
  } catch (error) {
    const safeError = error instanceof ApiProblem ? error : internalApiProblem();
    return apiProblemResponse(safeError, request, requestId);
  }
}
