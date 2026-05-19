"use client";

import { QUOTE_TEMPLATES, type QuoteTemplate } from "@/lib/quote-templates";
import { calculateClientPrice } from "@/lib/format";

function templateClientTotal(t: QuoteTemplate): number {
  return t.sections.reduce(
    (sum, s) =>
      s.items.reduce(
        (acc, it) =>
          acc + calculateClientPrice(it.unitCost, it.markupPercent) * it.quantity,
        sum
      ),
    0
  );
}

export function QuoteTemplatePicker({
  onPick,
}: Readonly<{ onPick: (t: QuoteTemplate) => void }>) {
  return (
    <div className="bg-orange-soft border border-orange/30 rounded-2xl p-4">
      <div className="text-sm font-bold text-orange-deep">
        用範本快速開始
      </div>
      <div className="text-[12px] text-ink-2 mt-0.5">
        一鍵帶入整套分類與行情價，改個數字就看到客戶價＋利潤
      </div>

      <div className="mt-3 space-y-2">
        {QUOTE_TEMPLATES.map((t) => {
          const itemCount = t.sections.reduce(
            (n, s) => n + s.items.length,
            0
          );
          const total = templateClientTotal(t);
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => onPick(t)}
              className="w-full text-left bg-surface border border-warm-border rounded-xl p-3 active:scale-[0.99] transition-transform"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[14px] font-bold text-ink">
                    {t.label}
                  </div>
                  <div className="text-[11px] text-ink-3 mt-0.5">
                    {t.desc} · {itemCount} 個項目
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-[10px] text-ink-3">參考客戶總價</div>
                  <div className="font-mono text-[15px] font-bold text-orange-deep tabular-nums">
                    NT${Math.round(total / 10000)} 萬
                  </div>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <div className="text-[10px] text-ink-3 mt-2.5">
        套用後所有數字都能改，這只是起點
      </div>
    </div>
  );
}
