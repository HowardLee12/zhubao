import Link from "next/link";
import { Pill } from "@/components/ui/pill";
import type { TradeRow, ProjectRow } from "@/lib/database.types";

function isTodayInRange(today: string, start: string | null, end: string | null): boolean {
  if (!start) return false;
  if (!end) return start === today;
  return start <= today && today <= end;
}

export function TodayTradeStrip({
  trades,
  projects,
}: {
  trades: (TradeRow & { project_address?: string })[];
  projects: ProjectRow[];
}) {
  const today = new Date().toISOString().slice(0, 10);
  const todayTrades = trades.filter((t) =>
    isTodayInRange(today, t.start_date, t.end_date)
  );

  if (todayTrades.length === 0) {
    return (
      <div className="mx-4 mb-2 px-4 py-3 rounded-xl bg-surface-warm border border-warm-border text-[12px] text-ink-3">
        今天沒有排定的工程。先確認本週工班，或新增一筆工程到排程。
      </div>
    );
  }

  return (
    <div
      className="flex gap-2 px-4 pb-2 overflow-x-auto"
      style={{ scrollbarWidth: "none" }}
    >
      {todayTrades.map((trade) => {
        const project = projects.find((p) => p.id === trade.project_id);
        if (!project) return null;
        return (
          <Link
            key={trade.id}
            href={`/projects/${trade.project_id}`}
            className="shrink-0 min-w-[180px] px-3 py-2.5 rounded-xl border border-warm-border bg-surface"
          >
            <div className="flex items-center gap-1.5 mb-1.5">
              <Pill variant="orange">{project.customer_name}</Pill>
            </div>
            <div className="text-[13px] font-semibold text-ink leading-tight">
              {trade.name}
            </div>
            <div className="text-[11px] text-ink-3 mt-1 font-mono">
              {trade.crew || "未指定工班"}
            </div>
          </Link>
        );
      })}
    </div>
  );
}
