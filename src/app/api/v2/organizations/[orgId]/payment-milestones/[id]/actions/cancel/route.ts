import { cancelPaymentMilestoneSchema } from "@/schemas/payment-milestone";
import { makePaymentActionRoute } from "@/server/payments/action-route";
import { cancelPaymentMilestone } from "@/server/payments/gateway";

export const dynamic = "force-dynamic";

export const POST = makePaymentActionRoute(cancelPaymentMilestoneSchema, cancelPaymentMilestone);
