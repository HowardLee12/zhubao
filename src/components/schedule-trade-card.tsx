"use client";

import { useState } from "react";
import { updateTrade } from "@/lib/actions";
import { useRouter } from "next/navigation";
import Link from "next/link";

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
  };
}) {
  const router = useRouter();
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleStatusChange = async (newStatus: TradeStatus) => {
    if (newStatus === trade.status) return;

    setUpdating(true);
    setError(null);
    try {
      await updateTrade(trade.id, { status: newStatus, projectId: trade.projectId });
      router.refresh();
    } catch {
      setError("更新失敗");
    } finally {
      setUpdating(false);
    }
  };

  return (
    <div
      className={`mx-4 my-2 bg-card rounded-xl p-3 shadow-sm flex gap-3 items-center ${
        trade.isConflict ? "border-l-[3px] border-destructive" : ""
      }`}
    >
      <div className="text-center min-w-[48px]">
        <div className="text-sm font-bold text-primary">08:00</div>
        <div className="text-[10px] text-muted-foreground">整天</div>
      </div>
      <div className="flex-1 min-w-0">
        <Link
          href={`/projects/${trade.projectId}`}
          className="text-sm font-medium truncate block text-primary underline-offset-2 hover:underline"
        >
          {trade.projectName}
        </Link>
        <div className="text-xs text-muted-foreground">{trade.name}</div>
        <div className="text-xs text-muted-foreground">{trade.crew}</div>
        {error && <div className="text-[10px] text-destructive mt-0.5">{error}</div>}
      </div>
      {trade.isConflict ? (
        <span className="text-[11px] px-2 py-0.5 rounded-full bg-red-50 text-destructive font-medium shrink-0">
          衝突
        </span>
      ) : (
        <select
          value={trade.status}
          onChange={(e) => handleStatusChange(e.target.value as TradeStatus)}
          disabled={updating}
          className={`text-[11px] font-semibold shrink-0 pl-2 pr-5 py-1 rounded-full border appearance-none cursor-pointer transition-all ${
            updating ? "opacity-50" : ""
          } ${statusSelectStyle[trade.status]}`}
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
      )}
    </div>
  );
}
