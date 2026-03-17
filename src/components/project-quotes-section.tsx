"use client";

import { useState } from "react";
import Link from "next/link";
import { InlineQuoteBuilder } from "@/components/inline-quote-builder";
import type { QuoteRow } from "@/lib/database.types";

export function ProjectQuotesSection({
  projectId,
  quotes,
  canCreate = true,
}: {
  projectId: string;
  quotes: QuoteRow[];
  canCreate?: boolean;
}) {
  const [showBuilder, setShowBuilder] = useState(false);
  const [cloneFromId, setCloneFromId] = useState<string | undefined>(undefined);

  const handleNewQuote = () => {
    setCloneFromId(undefined);
    setShowBuilder(true);
  };

  const handleCloneQuote = (quoteId: string) => {
    setCloneFromId(quoteId);
    setShowBuilder(true);
  };

  if (showBuilder) {
    return (
      <InlineQuoteBuilder
        projectId={projectId}
        cloneFromId={cloneFromId}
        onClose={() => setShowBuilder(false)}
      />
    );
  }

  return (
    <>
      <div className="flex justify-between items-center mb-3">
        <div className="text-sm font-semibold text-sage-800">報價單</div>
        {canCreate && (
          <button
            onClick={handleNewQuote}
            className="text-xs text-primary font-medium"
          >
            + 建立報價
          </button>
        )}
      </div>

      {!canCreate && quotes.length === 0 && (
        <div className="text-center py-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-700">
          免費方案最多 1 張報價單，請至帳號頁升級
        </div>
      )}

      {!canCreate && quotes.length > 0 && (
        <div className="mb-2 text-center py-2 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-700">
          已達免費方案上限，升級後可建立更多報價
        </div>
      )}

      {canCreate && quotes.length === 0 && (
        <button
          onClick={handleNewQuote}
          className="block w-full text-center py-3 border-2 border-dashed border-sage-300 rounded-xl text-sm text-sage-500 font-medium"
        >
          + 建立第一份報價單
        </button>
      )}

      {quotes.length > 0 && (
        <div className="space-y-2">
          <div className="flex gap-2 overflow-x-auto pb-1">
            {quotes.map((q) => (
              <Link
                key={q.id}
                href={`/quotes/${q.id}`}
                className="shrink-0 bg-card rounded-xl shadow-sm px-4 py-2.5 active:scale-[0.98] transition-transform"
              >
                <div className="text-xs font-semibold text-sage-700">v{q.version}</div>
                <div className="text-[10px] text-muted-foreground mt-0.5">
                  {new Date(q.created_at).toLocaleDateString("zh-TW")}
                </div>
              </Link>
            ))}
          </div>

          {/* Clone from latest version */}
          {canCreate && (
            <button
              onClick={() => handleCloneQuote(quotes[0].id)}
              className="w-full py-2 text-xs text-primary font-medium border border-dashed border-sage-300 rounded-xl"
            >
              + 以 v{quotes[0].version} 建立新版本
            </button>
          )}
        </div>
      )}
    </>
  );
}
