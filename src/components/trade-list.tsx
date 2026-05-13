"use client";

import { useState } from "react";
import { updateTrade, deleteTrade } from "@/lib/actions";
import { useRouter } from "next/navigation";
import { formatDate } from "@/lib/format";
import type { TradeRow } from "@/lib/database.types";

type TradeStatus = "pending" | "active" | "done";

const STATUS_OPTIONS: { value: TradeStatus; label: string }[] = [
  { value: "pending", label: "待排" },
  { value: "active", label: "進行中" },
  { value: "done", label: "完成" },
];

const statusSelectStyle: Record<TradeStatus, string> = {
  pending: "bg-gray-100 text-gray-600 border-gray-200",
  active: "bg-amber-50 text-amber-700 border-amber-200",
  done: "bg-sage-50 text-sage-700 border-sage-200",
};

const dotStyle: Record<TradeStatus, string> = {
  pending: "bg-gray-300",
  active: "bg-amber-500 animate-pulse",
  done: "bg-sage-600",
};

export function TradeList({
  trades,
  projectId,
  projectName,
  projectAddress,
}: {
  trades: TradeRow[];
  projectId: string;
  projectName: string;
  projectAddress: string;
}) {
  const router = useRouter();
  const [optimisticStatuses, setOptimisticStatuses] = useState<Record<string, TradeStatus>>({});
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [swipedId, setSwipedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const getStatus = (trade: TradeRow): TradeStatus =>
    optimisticStatuses[trade.id] ?? trade.status;

  const handleStatusChange = async (trade: TradeRow, newStatus: TradeStatus) => {
    if (newStatus === getStatus(trade)) return;

    const prevStatus = getStatus(trade);
    setOptimisticStatuses((prev) => ({ ...prev, [trade.id]: newStatus }));
    setError(null);
    try {
      await updateTrade(trade.id, { status: newStatus, projectId });
      router.refresh();
    } catch {
      setOptimisticStatuses((prev) => ({ ...prev, [trade.id]: prevStatus }));
      setError("狀態更新失敗，請重試");
    }
  };

  const handleDelete = async (trade: TradeRow) => {
    if (!globalThis.confirm(`確定要刪除「${trade.name}」嗎？`)) return;

    setDeletingId(trade.id);
    setError(null);
    try {
      await deleteTrade(trade.id, projectId);
      router.refresh();
    } catch {
      setError("刪除失敗，請重試");
    } finally {
      setDeletingId(null);
      setSwipedId(null);
    }
  };

  const handleShare = async (trade: TradeRow) => {
    const dateRange = trade.start_date && trade.end_date
      ? `${formatDate(trade.start_date)}~${formatDate(trade.end_date)}`
      : trade.start_date
        ? formatDate(trade.start_date)
        : "待定";

    const lines = [
      `${trade.name}工程通知`,
      "",
      `案件：${projectName}`,
      `地點：${projectAddress}`,
      `日期：${dateRange}`,
      trade.crew ? `工班：${trade.crew}` : "",
      "",
      "— Renoly",
    ].filter(Boolean);

    const text = lines.join("\n");

    if (navigator.share) {
      try {
        await navigator.share({ title: `${trade.name}工程通知`, text });
      } catch {
        // User cancelled
      }
    }
  };

  if (trades.length === 0) return null;

  return (
    <div className="bg-card rounded-xl shadow-sm divide-y divide-sage-50">
      {error && (
        <div className="px-4 py-2 text-xs text-destructive bg-red-50">{error}</div>
      )}
      {trades.map((trade) => {
        const status = getStatus(trade);
        const isDeleting = deletingId === trade.id;
        const isSwiped = swipedId === trade.id;

        return (
          <div key={trade.id} className="relative overflow-hidden">
            {/* Action buttons (revealed on swipe) */}
            <div className="absolute right-0 top-0 bottom-0 flex items-center">
              <button
                onClick={() => {
                  handleShare(trade);
                  setSwipedId(null);
                }}
                className="h-full px-3 bg-primary text-white text-xs font-medium"
              >
                通知
              </button>
              <button
                onClick={() => handleDelete(trade)}
                disabled={isDeleting}
                className="h-full px-3 bg-destructive text-white text-xs font-medium"
              >
                {isDeleting ? "..." : "刪除"}
              </button>
            </div>

            {/* Main content */}
            <div
              className={`relative bg-card flex items-center gap-3 px-4 py-2.5 transition-transform ${
                isSwiped ? "-translate-x-[7.5rem]" : "translate-x-0"
              }`}
              onClick={() => setSwipedId(isSwiped ? null : trade.id)}
            >
              {/* Status dot */}
              <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${dotStyle[status]}`} />

              <div className="flex-1 min-w-0">
                <div className={`text-[13px] ${status === "active" ? "font-semibold" : ""}`}>
                  {trade.name}
                </div>
                <div className="text-[11px] text-muted-foreground">{trade.crew || "未指定工班"}</div>
              </div>

              <div className="text-[11px] text-muted-foreground shrink-0">
                {trade.start_date && trade.end_date
                  ? `${formatDate(trade.start_date)}-${formatDate(trade.end_date)}`
                  : "待定"}
              </div>

              {/* Status dropdown */}
              <select
                value={status}
                onChange={(e) => {
                  e.stopPropagation();
                  handleStatusChange(trade, e.target.value as TradeStatus);
                }}
                onClick={(e) => e.stopPropagation()}
                className={`text-[11px] font-semibold shrink-0 pl-2 pr-5 py-1 rounded-full border appearance-none cursor-pointer transition-all ${statusSelectStyle[status]}`}
                style={{
                  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%23888' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E")`,
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
            </div>
          </div>
        );
      })}
    </div>
  );
}
