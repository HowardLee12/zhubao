import { reversePaymentMilestoneSchema } from "@/schemas/payment-milestone";
import { makePaymentActionRoute } from "@/server/payments/action-route";
import { reversePaymentMilestone } from "@/server/payments/gateway";

export const dynamic = "force-dynamic";

// Owner/admin only (enforced in the RPC). paid -> invoiced; the amount is never
// mutated; a reason is required and an append-only event is written.
export const POST = makePaymentActionRoute(reversePaymentMilestoneSchema, reversePaymentMilestone);
