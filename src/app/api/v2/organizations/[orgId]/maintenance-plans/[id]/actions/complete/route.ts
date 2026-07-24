import { completeMaintenancePlanSchema } from "@/schemas/maintenance-plan";
import { makeMaintenanceActionRoute } from "@/server/maintenance/action-route";
import { completeMaintenancePlan } from "@/server/maintenance/gateway";

export const dynamic = "force-dynamic";

// Recomputes next_due_on = (org-local completion date) + cadence months. The plan
// stays active for the next cycle.
export const POST = makeMaintenanceActionRoute(completeMaintenancePlanSchema, (args) =>
  completeMaintenancePlan({
    supabase: args.supabase,
    organizationId: args.organizationId,
    planId: args.planId,
    expectedLockVersion: args.expectedLockVersion,
    input: args.input,
    requestId: args.requestId,
  }),
);
