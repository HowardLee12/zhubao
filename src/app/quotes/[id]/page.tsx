"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { QuoteVersionToggle } from "@/components/quote-version-toggle";
import { QuoteSectionCard } from "@/components/quote-section-card";
import { formatCurrency, calculateSectionTotal } from "@/lib/format";
import { ViewMode, QuoteSection } from "@/lib/types";
import { shareQuoteToLine } from "@/lib/liff";
import { useLiff } from "@/components/liff-provider";

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
  const { ready: liffReady } = useLiff();
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
            const clientTotal = quote.sections.reduce(
              (sum, section) => sum + calculateSectionTotal(section.items, "client"),
              0
            );
            const quoteUrl = `${globalThis.location.origin}/quotes/${quote.id}`;
            const projectName = `${quote.customerName} ${quote.address}`;
            await shareQuoteToLine(quoteUrl, projectName, formatCurrency(clientTotal));
            setSharing(false);
          }}
          disabled={sharing || !liffReady}
          className="w-full bg-[#06C755] text-white py-3 rounded-xl font-semibold text-sm disabled:opacity-50 flex items-center justify-center gap-2"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19.365 9.863c.349 0 .63.285.63.631 0 .345-.281.63-.63.63H17.61v1.125h1.755c.349 0 .63.283.63.63 0 .344-.281.629-.63.629h-2.386c-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63h2.386c.346 0 .627.285.627.63 0 .349-.281.63-.63.63H17.61v1.125h1.755zm-3.855 3.016c0 .27-.174.51-.432.596-.064.021-.133.031-.199.031-.211 0-.391-.09-.51-.25l-2.443-3.317v2.94c0 .344-.279.629-.631.629-.346 0-.626-.285-.626-.629V8.108c0-.27.173-.51.43-.595.06-.023.136-.033.194-.033.195 0 .375.104.495.254l2.462 3.33V8.108c0-.345.282-.63.63-.63.345 0 .63.285.63.63v4.771zm-5.741 0c0 .344-.282.629-.631.629-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63.346 0 .628.285.628.63v4.771zm-2.466.629H4.917c-.345 0-.63-.285-.63-.629V8.108c0-.345.285-.63.63-.63.348 0 .63.285.63.63v4.141h1.756c.348 0 .629.283.629.63 0 .344-.282.629-.629.629M24 10.314C24 4.943 18.615.572 12 .572S0 4.943 0 10.314c0 4.811 4.27 8.842 10.035 9.608.391.082.923.258 1.058.59.12.301.079.766.038 1.08l-.164 1.02c-.045.301-.24 1.186 1.049.645 1.291-.539 6.916-4.078 9.436-6.975C23.176 14.393 24 12.458 24 10.314" />
          </svg>
          {sharing ? "分享中..." : "分享報價給屋主"}
        </button>
      </div>
    </div>
  );
}
