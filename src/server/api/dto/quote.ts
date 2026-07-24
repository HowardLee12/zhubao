interface InternalQuoteItem {
  name: string;
  unit: string;
  quantity: string;
  unitPriceMinor: string;
  totalMinor: string;
  unitCostMinor?: string;
  internalNotes?: string;
}

interface InternalQuote {
  merchant: { name: string; phone: string | null };
  quoteNo: string;
  versionNo: number;
  status: "sent" | "viewed" | "accepted" | "rejected" | "expired" | "cancelled";
  validUntil: string | null;
  currency: string;
  subtotalMinor: string;
  taxMinor: string;
  totalMinor: string;
  customerNotes: string;
  internalNotes?: string;
  items: InternalQuoteItem[];
}

export interface PublicQuoteDto {
  merchant: { name: string; phone: string | null };
  quoteNo: string;
  versionNo: number;
  status: InternalQuote["status"];
  validUntil: string | null;
  currency: string;
  subtotalMinor: string;
  taxMinor: string;
  totalMinor: string;
  customerNotes: string;
  items: Array<{
    name: string;
    unit: string;
    quantity: string;
    unitPriceMinor: string;
    totalMinor: string;
  }>;
}

export function toPublicQuoteDto(quote: InternalQuote): PublicQuoteDto {
  return {
    merchant: { name: quote.merchant.name, phone: quote.merchant.phone },
    quoteNo: quote.quoteNo,
    versionNo: quote.versionNo,
    status: quote.status,
    validUntil: quote.validUntil,
    currency: quote.currency,
    subtotalMinor: quote.subtotalMinor,
    taxMinor: quote.taxMinor,
    totalMinor: quote.totalMinor,
    customerNotes: quote.customerNotes,
    items: quote.items.map((item) => ({
      name: item.name,
      unit: item.unit,
      quantity: item.quantity,
      unitPriceMinor: item.unitPriceMinor,
      totalMinor: item.totalMinor,
    })),
  };
}
