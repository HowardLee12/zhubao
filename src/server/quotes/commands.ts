import type { QuoteDraftInput } from "@/schemas/quote";
import { ApiProblem } from "@/server/api/problem";
import {
  calculateQuoteTotals,
  QuoteCalculationError,
} from "@/server/domain/quotes/quote-calculation";

export function calculateValidatedQuoteDraft(draft: QuoteDraftInput) {
  try {
    return calculateQuoteTotals(
      draft.items.map((item) => ({
        quantity: item.quantity,
        unitCostMinor: item.unitCostMinor,
        unitPriceMinor: item.unitPriceMinor,
        discountMinor: item.discountMinor,
        taxRate: item.taxRate,
      })),
    );
  } catch (error) {
    if (error instanceof QuoteCalculationError) {
      throw new ApiProblem({
        status: 422,
        code: error.code,
        title: "報價金額無法計算",
        detail:
          error.code === "DISCOUNT_EXCEEDS_SUBTOTAL"
            ? "折扣不可大於該品項小計。"
            : "請檢查品項數量、單價、折扣與稅率。",
      });
    }
    throw error;
  }
}
