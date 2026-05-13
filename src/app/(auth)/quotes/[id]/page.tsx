"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { TopBar, TopBarIconButton } from "@/components/ui/top-bar";
import { Pill } from "@/components/ui/pill";
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

interface Totals {
  costTotal: number;
  clientTotal: number;
  profit: number;
  profitMargin: string;
}

function computeTotals(sections: QuoteSection[]): Totals {
  const costTotal = sections.reduce(
    (sum, s) => sum + calculateSectionTotal(s.items, "cost"),
    0
  );
  const clientTotal = sections.reduce(
    (sum, s) => sum + calculateSectionTotal(s.items, "client"),
    0
  );
  const profit = clientTotal - costTotal;
  const profitMargin =
    clientTotal > 0 ? ((profit / clientTotal) * 100).toFixed(1) : "0";
  return { costTotal, clientTotal, profit, profitMargin };
}

// ============ Icons ============
function IconEye() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
function IconEyeOff() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3l18 18M10 6a10 10 0 0 1 12 6 17 17 0 0 1-2.6 3.3M6.7 6.7C3.6 8.4 2 12 2 12s4 7 10 7a10 10 0 0 0 5.3-1.5" />
    </svg>
  );
}
function IconBack() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 18l-6-6 6-6" />
    </svg>
  );
}
function IconLine() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 3C6.5 3 2 6.7 2 11.2c0 3 2 5.7 5.2 7.1.2.1.5.3.6.5.1.2 0 .6 0 .9l-.2 1c-.1.3 0 .9.6.6.6-.3 3.4-2 4.6-2.9.7.1 1.4.1 2.2.1 5.5 0 10-3.7 10-8.3S17.5 3 12 3z" />
    </svg>
  );
}
function IconCopy() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

// ============ Sub-components ============
function ModeBanner({ showCost }: Readonly<{ showCost: boolean }>) {
  return (
    <div
      className={`mx-4 mt-1 mb-3 px-3 py-2.5 rounded-xl flex items-center gap-3 border ${
        showCost
          ? "bg-surface-warm border-warm-border"
          : "bg-orange-soft border-orange/40"
      }`}
    >
      <div
        className={`w-8 h-8 rounded-lg flex items-center justify-center text-white ${
          showCost ? "bg-ink" : "bg-orange"
        }`}
      >
        {showCost ? <IconEyeOff /> : <IconEye />}
      </div>
      <div className="flex-1 min-w-0">
        <div className={`text-[13px] font-bold ${showCost ? "text-ink" : "text-orange-deep"}`}>
          {showCost ? "成本版（只給自己看）" : "客戶版（隱藏成本）"}
        </div>
        <div className="text-[11px] text-ink-2 mt-0.5 truncate">
          {showCost ? "可以看到成本與利潤分析" : "可以直接 LINE 給屋主"}
        </div>
      </div>
      <Pill variant={showCost ? "dark" : "orange"}>
        {showCost ? "成本版" : "客戶版"}
      </Pill>
    </div>
  );
}

function TotalCard({ totals, showCost }: Readonly<{ totals: Totals; showCost: boolean }>) {
  const { costTotal, profit, profitMargin, clientTotal } = totals;

  return (
    <div
      className={`mx-4 mb-3 rounded-2xl p-4 border ${
        showCost
          ? "bg-ink text-white border-ink"
          : "bg-surface text-ink border-warm-border"
      }`}
    >
      {showCost && (
        <div className="grid grid-cols-3 gap-3 mb-3 pb-3 border-b border-white/15">
          <div>
            <div className="text-[10px] opacity-60">總成本</div>
            <div className="font-mono text-base font-bold mt-0.5 text-brick-soft tabular-nums">
              {formatCurrency(costTotal)}
            </div>
          </div>
          <div>
            <div className="text-[10px] opacity-60">利潤</div>
            <div className="font-mono text-base font-bold mt-0.5 text-orange-soft tabular-nums">
              {formatCurrency(profit)}
            </div>
            <div className="text-[10px] opacity-70">{profitMargin}%</div>
          </div>
          <div>
            <div className="text-[10px] opacity-60">客戶總價</div>
            <div className="font-mono text-base font-bold mt-0.5 tabular-nums">
              {formatCurrency(clientTotal)}
            </div>
          </div>
        </div>
      )}

      <div className="flex items-baseline justify-between gap-2">
        <div className={`text-xs ${showCost ? "opacity-70" : "text-ink-3"}`}>
          {showCost ? "報給屋主" : "工程總價"}
        </div>
        <div className="font-mono text-3xl font-bold tabular-nums tracking-tight">
          {formatCurrency(clientTotal)}
        </div>
      </div>
    </div>
  );
}

function ProfitBar({ totals }: Readonly<{ totals: Totals }>) {
  const { costTotal, clientTotal, profit, profitMargin } = totals;
  if (clientTotal <= 0) return null;

  return (
    <div className="mx-4 mb-3 bg-surface rounded-2xl border border-warm-border p-3.5">
      <div className="flex justify-between items-baseline text-[12px] mb-2">
        <span className="text-ink-2 font-medium">成本/利潤 結構</span>
        <span className="font-mono text-ink-3">毛利率 {profitMargin}%</span>
      </div>
      <div className="flex h-2.5 rounded-full overflow-hidden bg-bg-warm">
        <div className="bg-brick" style={{ width: `${(costTotal / clientTotal) * 100}%` }} />
        <div className="bg-orange" style={{ width: `${(profit / clientTotal) * 100}%` }} />
      </div>
      <div className="flex justify-between mt-2 text-[10px] font-mono">
        <span className="text-brick">■ 成本 {formatCurrency(costTotal)}</span>
        <span className="text-orange-deep">■ 利潤 {formatCurrency(profit)}</span>
      </div>
    </div>
  );
}

function ActionBar({
  cloneHref,
  onShare,
  sharing,
}: Readonly<{
  cloneHref: string;
  onShare: () => void;
  sharing: boolean;
}>) {
  return (
    <div className="px-4 mt-4 grid grid-cols-2 gap-2">
      <Link
        href={cloneHref}
        className="flex items-center justify-center gap-2 bg-surface border border-warm-border text-ink rounded-xl py-3 text-sm font-semibold active:scale-[0.98] transition-transform"
      >
        <IconCopy />
        複製為新版本
      </Link>
      <button
        type="button"
        onClick={onShare}
        disabled={sharing}
        className="flex items-center justify-center gap-2 bg-[#06C755] text-white rounded-xl py-3 text-sm font-semibold active:scale-[0.98] transition-transform disabled:opacity-50"
      >
        <IconLine />
        {sharing ? "分享中..." : "LINE 給屋主"}
      </button>
    </div>
  );
}

// ============ Page ============
export default function QuoteDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [mode, setMode] = useState<ViewMode>("cost");
  const [quote, setQuote] = useState<QuoteData | null>(null);
  const [loading, setLoading] = useState(true);
  const [sharing, setSharing] = useState(false);

  const fetchQuote = useCallback(async () => {
    try {
      const res = await fetch(`/api/quotes/${id}`);
      if (!res.ok) return;
      const data = (await res.json()) as QuoteData;
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
    return <div className="p-8 text-center text-ink-3 text-sm">載入中...</div>;
  }
  if (!quote) {
    return <div className="p-8 text-center text-ink-3 text-sm">找不到此報價單</div>;
  }

  const totals = computeTotals(quote.sections);
  const showCost = mode === "cost";

  const handleShare = async () => {
    setSharing(true);
    try {
      const quoteUrl = `${globalThis.location.origin}/quotes/${quote.id}/share`;
      const projectName = `${quote.customerName} ${quote.address}`;
      const totalText = formatCurrency(totals.clientTotal);
      if (navigator.share) {
        try {
          await navigator.share({
            title: `${projectName} 報價單`,
            text: `${projectName} 報價單\n工程總價：${totalText}`,
            url: quoteUrl,
          });
          return;
        } catch {
          // user cancelled — fall through to LINE
        }
      }
      await shareQuoteToLine(quoteUrl, projectName, totalText);
    } finally {
      setSharing(false);
    }
  };

  return (
    <div className="pb-24">
      <TopBar
        title={<span>{quote.customerName} · v{quote.version}</span>}
        subtitle={quote.address}
        back={
          <button
            type="button"
            aria-label="返回"
            onClick={() => router.back()}
            className="w-9 h-9 rounded-xl border border-warm-border bg-surface flex items-center justify-center text-ink-2"
          >
            <IconBack />
          </button>
        }
        right={
          <TopBarIconButton
            onClick={() => setMode(showCost ? "client" : "cost")}
            variant={showCost ? "default" : "primary"}
            ariaLabel={showCost ? "切換為客戶版" : "切換為成本版"}
          >
            {showCost ? <IconEye /> : <IconEyeOff />}
          </TopBarIconButton>
        }
      />

      <ModeBanner showCost={showCost} />
      <TotalCard totals={totals} showCost={showCost} />
      {showCost && <ProfitBar totals={totals} />}

      <div className="px-4 space-y-3">
        {quote.sections.map((section) => (
          <QuoteSectionCard key={section.id} section={section} mode={mode} />
        ))}
      </div>

      <div className="px-5 mt-3 text-[11px] text-ink-3 leading-relaxed">
        {showCost
          ? "💡 切換右上眼睛圖示 → 隱藏成本後可直接 LINE 給屋主。"
          : "🔒 客戶版只看得到客戶單價，成本與利潤完全隱藏。"}
      </div>

      <ActionBar
        cloneHref={`/quotes/new?projectId=${quote.projectId}&cloneFrom=${quote.id}`}
        onShare={handleShare}
        sharing={sharing}
      />
    </div>
  );
}
