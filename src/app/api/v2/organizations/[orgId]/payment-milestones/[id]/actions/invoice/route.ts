import { invoicePaymentMilestoneSchema } from "@/schemas/payment-milestone";
import { makePaymentActionRoute } from "@/server/payments/action-route";
import { invoicePaymentMilestone } from "@/server/payments/gateway";

export const dynamic = "force-dynamic";

export const POST = makePaymentActionRoute(invoicePaymentMilestoneSchema, invoicePaymentMilestone);
