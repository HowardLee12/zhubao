import { waivePaymentMilestoneSchema } from "@/schemas/payment-milestone";
import { makePaymentActionRoute } from "@/server/payments/action-route";
import { waivePaymentMilestone } from "@/server/payments/gateway";

export const dynamic = "force-dynamic";

export const POST = makePaymentActionRoute(waivePaymentMilestoneSchema, waivePaymentMilestone);
