"use client";

import { ViewMode } from "@/lib/types";

interface QuoteVersionToggleProps {
  mode: ViewMode;
  onToggle: (mode: ViewMode) => void;
}

export function QuoteVersionToggle({ mode, onToggle }: QuoteVersionToggleProps) {
  return (
    <div className="flex bg-bg-warm rounded-xl p-1">
      <button
        type="button"
        onClick={() => onToggle("cost")}
        className={`flex-1 py-2 px-3 rounded-lg text-xs font-semibold transition-all ${
          mode === "cost"
            ? "bg-surface text-orange shadow-sm"
            : "text-ink-3"
        }`}
      >
        成本版
      </button>
      <button
        type="button"
        onClick={() => onToggle("client")}
        className={`flex-1 py-2 px-3 rounded-lg text-xs font-semibold transition-all ${
          mode === "client"
            ? "bg-surface text-orange shadow-sm"
            : "text-ink-3"
        }`}
      >
        客戶版
      </button>
    </div>
  );
}
