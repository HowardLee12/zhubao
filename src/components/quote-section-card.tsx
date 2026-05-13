"use client";

import { QuoteSection, ViewMode } from "@/lib/types";
import { formatCurrency, calculateClientPrice, calculateSectionTotal } from "@/lib/format";

interface QuoteSectionCardProps {
  section: QuoteSection;
  mode: ViewMode;
}

export function QuoteSectionCard({ section, mode }: QuoteSectionCardProps) {
  const sectionTotal = calculateSectionTotal(section.items, mode);

  return (
    <div className="bg-surface rounded-2xl border border-warm-border overflow-hidden">
      <div className="px-4 py-2.5 bg-bg-warm flex justify-between items-center border-b border-warm-border">
        <span className="text-sm font-semibold text-ink-2 flex items-center gap-1.5">
          <span className="text-base leading-none">{section.icon}</span>
          {section.name}
        </span>
        <span className="text-sm font-bold text-ink font-mono tabular-nums">
          {formatCurrency(sectionTotal)}
        </span>
      </div>

      <div className="divide-y divide-warm-border">
        {section.items.map((item) => {
          const clientUnitPrice = calculateClientPrice(item.unitCost, item.markupPercent);
          const costTotal = item.unitCost * item.quantity;
          const clientTotal = clientUnitPrice * item.quantity;
          const displayTotal = mode === "cost" ? costTotal : clientTotal;

          return (
            <div key={item.id} className="px-4 py-2.5 flex justify-between items-center">
              <div className="min-w-0 flex-1">
                <div className="text-[13px] text-ink font-medium">{item.name}</div>
                <div className="text-[11px] text-ink-3">
                  {item.spec && <span>{item.spec} · </span>}
                  <span className="font-mono">
                    {item.quantity} {item.unit}
                  </span>
                  {mode === "cost" && (
                    <span className="ml-1 text-brick">
                      · +{item.markupPercent}%
                    </span>
                  )}
                </div>
              </div>
              <div className="text-right shrink-0 ml-3">
                <div className="text-[13px] font-bold text-ink font-mono tabular-nums">
                  {formatCurrency(displayTotal)}
                </div>
                {mode === "cost" && (
                  <div className="text-[10px] text-orange-deep font-mono tabular-nums">
                    報客 {formatCurrency(clientTotal)}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
