import { cancelMaintenancePlanSchema } from "@/schemas/maintenance-plan";
import { makeMaintenanceActionRoute } from "@/server/maintenance/action-route";
import { cancelMaintenancePlan } from "@/server/maintenance/gateway";

export const dynamic = "force-dynamic";

export const POST = makeMaintenanceActionRoute(cancelMaintenancePlanSchema, (args) =>
  cancelMaintenancePlan({
    supabase: args.supabase,
    organizationId: args.organizationId,
    planId: args.planId,
    expectedLockVersion: args.expectedLockVersion,
    reason: args.input.reason,
    occurredAt: args.input.occurredAt,
    requestId: args.requestId,
  }),
);
