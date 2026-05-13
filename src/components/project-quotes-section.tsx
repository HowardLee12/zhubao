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

  const openNew = () => {
    setCloneFromId(undefined);
    setShowBuilder(true);
  };

  const openClone = (quoteId: string) => {
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
      <div className="flex justify-between items-center mb-2">
        <div className="text-[13px] font-semibold text-ink-2 tracking-wider">
          報價單
        </div>
        {canCreate && (
          <button
            type="button"
            onClick={openNew}
            className="text-xs text-orange font-semibold"
          >
            + 建立報價
          </button>
        )}
      </div>

      {!canCreate && (
        <div className="mb-2 px-3 py-2 bg-amber-soft border border-amber/40 rounded-xl text-xs text-amber">
          {quotes.length === 0
            ? "報價單已達免費方案上限，請至帳號頁升級"
            : "已達免費方案上限，升級後可建立更多報價"}
        </div>
      )}

      {canCreate && quotes.length === 0 && (
        <button
          type="button"
          onClick={openNew}
          className="block w-full text-center py-3 border-2 border-dashed border-warm-border-strong rounded-xl text-sm text-ink-2 font-medium bg-surface-warm"
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
                className="shrink-0 bg-surface border border-warm-border rounded-xl px-3.5 py-2.5 active:scale-[0.98] transition-transform"
              >
                <div className="text-xs font-bold text-orange font-mono">
                  v{q.version}
                </div>
                <div className="text-[10px] text-ink-3 mt-0.5 font-mono">
                  {new Date(q.created_at).toLocaleDateString("zh-TW")}
                </div>
              </Link>
            ))}
          </div>

          {canCreate && (
            <button
              type="button"
              onClick={() => openClone(quotes[0].id)}
              className="w-full py-2 text-xs text-orange font-semibold border-2 border-dashed border-warm-border-strong rounded-xl bg-surface-warm"
            >
              + 以 v{quotes[0].version} 建立新版本
            </button>
          )}
        </div>
      )}
    </>
  );
}
