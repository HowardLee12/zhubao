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
    <div className="bg-card rounded-xl shadow-sm overflow-hidden">
      <div className="px-4 py-2.5 bg-sage-100 flex justify-between items-center">
        <span className="text-sm font-semibold text-sage-800">
          {section.icon} {section.name}
        </span>
        <span className="text-sm font-semibold text-sage-700">
          {formatCurrency(sectionTotal)}
        </span>
      </div>

      <div className="divide-y divide-sage-50">
        {section.items.map((item) => {
          const price = mode === "cost"
            ? item.unitCost * item.quantity
            : calculateClientPrice(item.unitCost, item.markupPercent) * item.quantity;

          return (
            <div key={item.id} className="px-4 py-2.5 flex justify-between items-center">
              <div className="min-w-0 flex-1">
                <div className="text-[13px]">{item.name}</div>
                <div className="text-[11px] text-muted-foreground">
                  {item.spec}
                  {mode === "cost" && (
                    <span className="ml-1 text-sage-400">
                      · 加價 {item.markupPercent}%
                    </span>
                  )}
                </div>
              </div>
              <div className="text-right shrink-0 ml-3">
                <div className="text-[13px] font-semibold">{formatCurrency(price)}</div>
                {mode === "cost" && (
                  <div className="text-[10px] text-muted-foreground">
                    報客 {formatCurrency(calculateClientPrice(item.unitCost, item.markupPercent) * item.quantity)}
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
