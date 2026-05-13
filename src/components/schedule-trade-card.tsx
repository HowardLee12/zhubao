"use client";

import { useState } from "react";
import { updateTrade } from "@/lib/actions";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Pill } from "@/components/ui/pill";

type TradeStatus = "pending" | "active" | "done";

const STATUS_OPTIONS: { value: TradeStatus; label: string }[] = [
  { value: "pending", label: "待排" },
  { value: "active", label: "進行中" },
  { value: "done", label: "完成" },
];

const statusStyle: Record<TradeStatus, string> = {
  pending: "bg-bg-warm text-ink-2 border-warm-border",
  active: "bg-orange-soft text-orange-deep border-orange/40",
  done: "bg-[var(--warm-green-soft)] text-[var(--warm-green)] border-[var(--warm-green)]/30",
};

export function ScheduleTradeCard({
  trade,
}: {
  trade: {
    id: string;
    name: string;
    crew: string;
    status: TradeStatus;
    projectId: string;
    projectName: string;
    isConflict: boolean;
    startDate?: string | null;
  };
}) {
  const router = useRouter();
  const [optimisticStatus, setOptimisticStatus] = useState(trade.status);
  const [error, setError] = useState<string | null>(null);

  const handleStatusChange = async (newStatus: TradeStatus) => {
    if (newStatus === optimisticStatus) return;
    const prev = optimisticStatus;
    setOptimisticStatus(newStatus);
    setError(null);
    try {
      await updateTrade(trade.id, {
        status: newStatus,
        projectId: trade.projectId,
      });
      router.refresh();
    } catch {
      setOptimisticStatus(prev);
      setError("更新失敗");
    }
  };

  const day = trade.startDate ? Number(trade.startDate.slice(8, 10)) : null;
  const month = trade.startDate ? Number(trade.startDate.slice(5, 7)) : null;

  return (
    <div
      className={`mx-4 my-2 rounded-2xl bg-surface border p-3 flex gap-3 items-center ${
        trade.isConflict ? "border-[var(--warm-red)]" : "border-warm-border"
      }`}
    >
      {/* Date column */}
      <div className="text-center min-w-[44px]">
        {day !== null && month !== null ? (
          <>
            <div className="text-[10px] text-ink-3 font-mono">{month}月</div>
            <div className="text-xl font-bold text-ink leading-tight font-mono tabular-nums">
              {day}
            </div>
          </>
        ) : (
          <div className="text-[11px] text-ink-3">待排</div>
        )}
      </div>

      <div className="w-px h-9 bg-warm-border shrink-0" />

      {/* Body */}
      <div className="flex-1 min-w-0">
        <Link
          href={`/projects/${trade.projectId}`}
          className="text-[13px] font-semibold text-ink truncate block"
        >
          {trade.name}
        </Link>
        <div className="text-[11px] text-ink-3 mt-0.5 truncate">
          {trade.projectName}
        </div>
        <div className="text-[11px] text-ink-3 mt-0.5">
          {trade.crew || "未指定工班"}
        </div>
        {error && (
          <div className="text-[10px] text-[var(--warm-red)] mt-0.5">{error}</div>
        )}
      </div>

      {/* Status / conflict */}
      {trade.isConflict ? (
        <Pill variant="red" className="shrink-0">
          衝突
        </Pill>
      ) : (
        <select
          value={optimisticStatus}
          onChange={(e) => handleStatusChange(e.target.value as TradeStatus)}
          className={`text-[11px] font-semibold shrink-0 pl-2.5 pr-5 py-1 rounded-full border appearance-none cursor-pointer transition-all ${statusStyle[optimisticStatus]}`}
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%239C8A78' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E")`,
            backgroundRepeat: "no-repeat",
            backgroundPosition: "right 6px center",
          }}
        >
          {STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
