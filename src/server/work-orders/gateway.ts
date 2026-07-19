import type { SupabaseClient } from "@supabase/supabase-js";

import {
  TRANSITION_TARGET_STATUS,
  type RouteTransitionAction,
} from "@/schemas/work-order-transition";
import {
  decideWorkOrderTransition,
  type WorkOrderActorRole,
  type WorkOrderStatus,
  type WorkOrderTransitionFacts,
} from "@/server/domain/work-orders/work-order-state";
import { ApiProblem } from "@/server/api/problem";
import { mapWorkOrderRpcError } from "@/server/api/work-order-errors";
import {
  computeWorkMediaActuals,
  signWorkMediaReadUrl,
} from "@/server/api/work-order-photos";
import { internalApiProblem } from "@/server/supabase/http";

type Rpc = Pick<SupabaseClient, "rpc">;

// The action -> DB target_status map is re-exported from the schema module so the
// gateway stays the single caller. It is intentionally NOT a re-implementation of
// the transition matrix; decideWorkOrderTransition (domain) owns legality and the
// DB RPC re-enforces it.
export { TRANSITION_TARGET_STATUS };

export interface TransitionPreCheckInput {
  status: WorkOrderStatus;
  action: RouteTransitionAction;
  role: WorkOrderActorRole;
  isAssigned: boolean;
  now: string;
  occurredAt: string;
  facts: WorkOrderTransitionFacts;
}

// Fast, domain-driven pre-check. When it rejects, it produces a specific problem
// (403/409/422) BEFORE the DB round-trip. When it allows, the caller still runs
// the authoritative DB transition — the DB, not this function, is the gate of
// record. `reopen` is owner-gated in the domain and re-checked by the DB.
export function preCheckWorkOrderTransition(input: TransitionPreCheckInput): ApiProblem | null {
  const decision = decideWorkOrderTransition({
    status: input.status,
    action: input.action,
    actor: { role: input.role, isAssigned: input.isAssigned },
    now: input.now,
    occurredAt: input.occurredAt,
    facts: input.facts,
  });

  if (decision.allowed) return null;

  switch (decision.code) {
    case "FORBIDDEN":
    case "NOT_ASSIGNED":
      return new ApiProblem({
        status: 403,
        code: "FORBIDDEN",
        title: "沒有權限",
        detail: "你沒有權限對這個工單執行這個操作。",
      });
    case "INVALID_STATE_TRANSITION":
      return new ApiProblem({
        status: 409,
        code: "INVALID_STATE_TRANSITION",
        title: "無法執行這個操作",
        detail: "工單目前的狀態不允許這個操作，請重新整理後再確認。",
      });
    case "REOPEN_WINDOW_EXPIRED":
      return new ApiProblem({
        status: 409,
        code: "INVALID_STATE_TRANSITION",
        title: "無法重新開啟工單",
        detail: "重新開啟的時間窗已過或狀態不符，請聯絡管理者。",
      });
    default:
      return new ApiProblem({
        status: 422,
        code: "VALIDATION_FAILED",
        title: "完工或轉移條件未滿足",
        detail: buildMissingDetail(decision.missing),
      });
  }
}

function buildMissingDetail(missing: readonly string[] | undefined): string {
  if (!missing || missing.length === 0) {
    return "請確認排程、指派、檢查表與照片等必要條件後再試一次。";
  }
  return `尚未滿足的條件：${missing.join("、")}。`;
}

export function targetStatusFor(action: RouteTransitionAction): WorkOrderStatus {
  return TRANSITION_TARGET_STATUS[action] as WorkOrderStatus;
}

// Verify-and-mark-ready orchestration. Downloads the reserved object, computes
// its real MIME/size/sha256/dimensions and calls complete_work_order_photo, which
// cross-checks the actuals against the declared values before flipping to ready.
export async function completeWorkOrderPhoto(command: {
  supabase: Rpc;
  organizationId: string;
  photoId: string;
  storagePath: string;
  requestId: string;
}): Promise<Record<string, unknown>> {
  const actuals = await computeWorkMediaActuals(command.storagePath);
  const { data, error } = await command.supabase.rpc("complete_work_order_photo", {
    target_org: command.organizationId,
    target_photo: command.photoId,
    p_actual_mime_type: actuals.mimeType,
    p_actual_byte_size: actuals.byteSize,
    p_actual_sha256: actuals.sha256,
    p_image_width: actuals.width,
    p_image_height: actuals.height,
    p_request_id: command.requestId,
  });
  if (error) throw mapWorkOrderRpcError(error);
  if (!data || typeof data !== "object") throw internalApiProblem();
  return data as Record<string, unknown>;
}

// Authorize a photo read via the RPC (authz gate + storage path), then mint the
// signed URL with the admin signer. The signed URL is never logged.
export async function resolveWorkOrderPhotoReadUrl(command: {
  supabase: Rpc;
  organizationId: string;
  photoId: string;
}): Promise<{ photoId: string; url: string; expiresAt: string }> {
  const { data, error } = await command.supabase.rpc("get_work_order_photo_read_url", {
    target_org: command.organizationId,
    target_photo: command.photoId,
  });
  if (error) throw mapWorkOrderRpcError(error);

  const grant = data as { photoId?: string; storagePath?: string } | null;
  if (!grant || typeof grant.storagePath !== "string" || typeof grant.photoId !== "string") {
    throw internalApiProblem();
  }

  const signed = await signWorkMediaReadUrl(grant.storagePath);
  return { photoId: grant.photoId, url: signed.url, expiresAt: signed.expiresAt };
}
