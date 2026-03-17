"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { QuoteVersionToggle } from "@/components/quote-version-toggle";
import { QuoteSectionCard } from "@/components/quote-section-card";
import { formatCurrency, calculateSectionTotal } from "@/lib/format";
import { ViewMode, QuoteSection } from "@/lib/types";
import { shareQuoteToLine } from "@/lib/liff";

interface QuoteData {
  id: string;
  projectId: string;
  version: number;
  customerName: string;
  address: string;
  sections: QuoteSection[];
}

export default function QuoteDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [mode, setMode] = useState<ViewMode>("client");
  const [quote, setQuote] = useState<QuoteData | null>(null);
  const [loading, setLoading] = useState(true);
  const [sharing, setSharing] = useState(false);

  const fetchQuote = useCallback(async () => {
    try {
      const res = await fetch(`/api/quotes/${id}`);
      if (!res.ok) return;
      const data = await res.json() as QuoteData;
      setQuote(data);
    } catch {
      // network error — user sees "not found" state
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchQuote();
  }, [fetchQuote]);

  if (loading) {
    return <div className="p-8 text-center text-muted-foreground text-sm">載入中...</div>;
  }

  if (!quote) {
    return <div className="p-8 text-center text-muted-foreground text-sm">找不到此報價單</div>;
  }

  const grandTotal = quote.sections.reduce(
    (sum, section) => sum + calculateSectionTotal(section.items, mode),
    0
  );
  const costTotal = quote.sections.reduce(
    (sum, section) => sum + calculateSectionTotal(section.items, "cost"),
    0
  );
  const profit = grandTotal - costTotal;
  const profitMargin = grandTotal > 0 ? ((profit / grandTotal) * 100).toFixed(1) : "0";

  return (
    <div>
      <header className="bg-primary text-primary-foreground px-4 py-3">
        <button onClick={() => router.back()} className="text-xs opacity-80">{"← 返回"}</button>
        <div className="text-lg font-bold mt-1">報價單</div>
        <div className="text-xs opacity-80">
          {quote.customerName} {quote.address} · v{quote.version}
        </div>
      </header>

      <div className="p-4">
        <QuoteVersionToggle mode={mode} onToggle={setMode} />
      </div>

      {mode === "cost" && (
        <div className="mx-4 mb-3 bg-sage-700 text-white rounded-xl p-3 flex justify-between items-center">
          <div>
            <div className="text-[11px] opacity-80">成本</div>
            <div className="text-sm font-bold">{formatCurrency(costTotal)}</div>
          </div>
          <div className="text-center">
            <div className="text-[11px] opacity-80">利潤</div>
            <div className="text-sm font-bold">{formatCurrency(profit)}</div>
          </div>
          <div className="text-right">
            <div className="text-[11px] opacity-80">毛利率</div>
            <div className="text-sm font-bold">{profitMargin}%</div>
          </div>
        </div>
      )}

      <div className="px-4 space-y-3">
        {quote.sections.map((section) => (
          <QuoteSectionCard key={section.id} section={section} mode={mode} />
        ))}
      </div>

      <div className="mx-4 my-4 bg-card rounded-xl shadow-sm p-4 flex justify-between items-center">
        <span className="text-base font-bold">
          {mode === "cost" ? "成本總計" : "工程總價"}
        </span>
        <span className="text-lg font-bold text-primary">
          {formatCurrency(grandTotal)}
        </span>
      </div>

      <div className="px-4 pb-4 space-y-2">
        <Link
          href={`/quotes/new?projectId=${quote.projectId}&cloneFrom=${quote.id}`}
          className="block w-full text-center bg-sage-700 text-white py-3 rounded-xl font-semibold text-sm"
        >
          以此版本建立新報價
        </Link>
        <button
          onClick={async () => {
            if (!quote) return;
            setSharing(true);
            try {
              const clientTotal = quote.sections.reduce(
                (sum, section) => sum + calculateSectionTotal(section.items, "client"),
                0
              );
              const quoteUrl = `${globalThis.location.origin}/quotes/${quote.id}/share`;
              const projectName = `${quote.customerName} ${quote.address}`;
              const totalText = formatCurrency(clientTotal);

              // Try native share (iPhone share sheet) first
              if (navigator.share) {
                try {
                  await navigator.share({
                    title: `${projectName} 報價單`,
                    text: `${projectName} 報價單\n工程總價：${totalText}`,
                    url: quoteUrl,
                  });
                  return;
                } catch {
                  // User cancelled or share failed — try LINE fallback
                }
              }

              // Fallback: LINE share via LIFF
              await shareQuoteToLine(quoteUrl, projectName, totalText);
            } finally {
              setSharing(false);
            }
          }}
          disabled={sharing}
          className="w-full bg-primary text-primary-foreground py-3 rounded-xl font-semibold text-sm disabled:opacity-50 flex items-center justify-center gap-2"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
            <polyline points="16 6 12 2 8 6" />
            <line x1="12" y1="2" x2="12" y2="15" />
          </svg>
          {sharing ? "分享中..." : "分享報價給屋主"}
        </button>
      </div>
    </div>
  );
}
