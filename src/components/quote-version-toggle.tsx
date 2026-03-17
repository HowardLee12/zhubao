"use client";

import { ViewMode } from "@/lib/types";

interface QuoteVersionToggleProps {
  mode: ViewMode;
  onToggle: (mode: ViewMode) => void;
}

export function QuoteVersionToggle({ mode, onToggle }: QuoteVersionToggleProps) {
  return (
    <div className="flex bg-sage-100 rounded-lg p-0.5">
      <button
        onClick={() => onToggle("cost")}
        className={`flex-1 py-1.5 px-3 rounded-md text-xs font-medium transition-all ${
          mode === "cost"
            ? "bg-white text-sage-800 shadow-sm"
            : "text-muted-foreground"
        }`}
      >
        成本版
      </button>
      <button
        onClick={() => onToggle("client")}
        className={`flex-1 py-1.5 px-3 rounded-md text-xs font-medium transition-all ${
          mode === "client"
            ? "bg-white text-sage-800 shadow-sm"
            : "text-muted-foreground"
        }`}
      >
        報客版
      </button>
    </div>
  );
}
