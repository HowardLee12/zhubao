import { markPaymentMilestonePaidSchema } from "@/schemas/payment-milestone";
import { makePaymentActionRoute } from "@/server/payments/action-route";
import { markPaymentMilestonePaid } from "@/server/payments/gateway";

export const dynamic = "force-dynamic";

// Tracking only: this never calls a payment gateway. The RPC screens the metadata,
// method and reference for card/CVV/bank-secret-looking values and rejects with 422.
export const POST = makePaymentActionRoute(markPaymentMilestonePaidSchema, markPaymentMilestonePaid);
