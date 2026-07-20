import { emptyOccurredAtSchema } from "@/schemas/maintenance-plan";
import { makeMaintenanceActionRoute } from "@/server/maintenance/action-route";
import { pauseMaintenancePlan } from "@/server/maintenance/gateway";

export const dynamic = "force-dynamic";

export const POST = makeMaintenanceActionRoute(emptyOccurredAtSchema, (args) =>
  pauseMaintenancePlan({
    supabase: args.supabase,
    organizationId: args.organizationId,
    planId: args.planId,
    expectedLockVersion: args.expectedLockVersion,
    occurredAt: args.input.occurredAt,
    requestId: args.requestId,
  }),
);
