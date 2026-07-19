import { z } from "zod";

const occurredAt = z.iso.datetime({ offset: true });
const nullableOverrideReason = z.string().trim().min(1).max(2_000).nullable().optional();

// The generic transition route handles every status action EXCEPT schedule (which
// has its own atomic schedule+assign route) and force-complete (owner override,
// separate route). dispatch/enRoute/arrive/pause/resume carry no extra body;
// complete needs a summary; cancel/reopen need a reason.
const simpleTransitionSchema = z
  .object({
    action: z.enum(["dispatch", "enRoute", "arrive", "pause", "resume"]),
    occurredAt,
    overrideReason: nullableOverrideReason,
  })
  .strict();

const completeTransitionSchema = z
  .object({
    action: z.literal("complete"),
    occurredAt,
    completionSummary: z.string().trim().min(1).max(10_000),
    overrideReason: nullableOverrideReason,
  })
  .strict();

const cancelTransitionSchema = z
  .object({
    action: z.literal("cancel"),
    occurredAt,
    reason: z.string().trim().min(1).max(2_000),
    overrideReason: nullableOverrideReason,
  })
  .strict();

const reopenTransitionSchema = z
  .object({
    action: z.literal("reopen"),
    occurredAt,
    reason: z.string().trim().min(1).max(2_000),
    overrideReason: nullableOverrideReason,
  })
  .strict();

export const workOrderRouteTransitionSchema = z.discriminatedUnion("action", [
  simpleTransitionSchema,
  completeTransitionSchema,
  cancelTransitionSchema,
  reopenTransitionSchema,
]);

export type WorkOrderRouteTransitionInput = z.infer<typeof workOrderRouteTransitionSchema>;

// Action -> DB target_status map. Single source of truth for the gateway; the
// transition matrix itself lives in decideWorkOrderTransition (domain) and is
// authoritatively re-enforced by transition_work_order (DB). This map only routes
// an action name to the target status those two agree on.
export const TRANSITION_TARGET_STATUS = {
  dispatch: "dispatched",
  enRoute: "en_route",
  arrive: "on_site",
  pause: "paused",
  resume: "on_site",
  complete: "completed",
  cancel: "cancelled",
  reopen: "on_site",
} as const;

export type RouteTransitionAction = keyof typeof TRANSITION_TARGET_STATUS;
