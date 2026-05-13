import { getProjects } from "@/lib/queries";
import { formatScheduleDate } from "@/lib/format";
import { ScheduleTradeCard } from "@/components/schedule-trade-card";
import { TopBar } from "@/components/ui/top-bar";
import { Pill } from "@/components/ui/pill";

export const dynamic = "force-dynamic";

type FlatTrade = {
  id: string;
  name: string;
  crew: string;
  status: "pending" | "active" | "done";
  start_date: string | null;
  end_date: string | null;
  projectId: string;
  projectName: string;
};

function detectConflicts(trades: FlatTrade[]): Set<string> {
  const dateCrewMap = new Map<string, string[]>();
  for (const t of trades) {
    if (!t.start_date || !t.crew) continue;
    const key = `${t.start_date}::${t.crew}`;
    const existing = dateCrewMap.get(key) ?? [];
    dateCrewMap.set(key, [...existing, t.id]);
  }
  return new Set(
    Array.from(dateCrewMap.values())
      .filter((ids) => ids.length > 1)
      .flat()
  );
}

function groupByDate(trades: FlatTrade[]): Record<string, FlatTrade[]> {
  return trades
    .filter((t) => t.start_date)
    .sort((a, b) => (a.start_date ?? "").localeCompare(b.start_date ?? ""))
    .reduce<Record<string, FlatTrade[]>>((acc, trade) => {
      const date = trade.start_date ?? "";
      return { ...acc, [date]: [...(acc[date] ?? []), trade] };
    }, {});
}

export default async function SchedulePage() {
  const projects = await getProjects();
  const today = new Date().toISOString().slice(0, 10);

  const allTrades: FlatTrade[] = projects.flatMap((p) =>
    p.trades.map((t) => ({
      id: t.id,
      name: t.name,
      crew: t.crew,
      status: t.status,
      start_date: t.start_date,
      end_date: t.end_date,
      projectId: p.id,
      projectName: `${p.customer_name} · ${p.description || p.address}`,
    }))
  );

  const conflictIds = detectConflicts(allTrades);
  const tradesByDate = groupByDate(allTrades);
  const unscheduled = allTrades.filter((t) => !t.start_date);
  const activeCount = allTrades.filter((t) => t.status === "active").length;
  const conflictCount = conflictIds.size;

  return (
    <div className="pb-24">
      <TopBar
        title="工班排程"
        subtitle={
          <span>
            {Object.keys(tradesByDate).length} 個工作日
            {activeCount > 0 ? ` · 進行中 ${activeCount} 項` : ""}
          </span>
        }
        right={
          conflictCount > 0 ? (
            <Pill variant="red">{conflictCount} 衝突</Pill>
          ) : undefined
        }
      />

      {conflictCount > 0 && (
        <div className="mx-4 mt-1 mb-2 px-3 py-2.5 rounded-xl bg-[var(--warm-red-soft)] border border-[var(--warm-red)]/30 flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-[var(--warm-red)] text-white flex items-center justify-center shrink-0">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3l10 18H2z" />
              <path d="M12 10v5M12 18v.01" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[12px] font-bold text-[var(--warm-red)]">
              偵測到 {conflictCount} 個師傅撞期
            </div>
            <div className="text-[11px] text-ink-2 mt-0.5">
              同一師傅同一天被安排到兩個工地，請調整日期或改派
            </div>
          </div>
        </div>
      )}

      {Object.keys(tradesByDate).length === 0 && unscheduled.length === 0 && (
        <div className="text-center py-16 px-6">
          <div className="w-14 h-14 mx-auto mb-3 rounded-2xl bg-bg-warm border border-warm-border flex items-center justify-center">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="text-ink-3">
              <rect x="3" y="5" width="18" height="16" rx="2" />
              <path d="M3 10h18M8 3v4M16 3v4" />
            </svg>
          </div>
          <div className="text-sm text-ink-2 mb-1">還沒有排程</div>
          <div className="text-xs text-ink-3">先去案件頁新增工種與日期</div>
        </div>
      )}

      {/* Scheduled trades grouped by date */}
      {Object.entries(tradesByDate).map(([date, trades]) => {
        const isToday = date === today;
        return (
          <div key={date}>
            <div
              className={`mt-3 mx-4 mb-1 flex items-center gap-2 text-[12px] font-bold tracking-wider ${
                isToday ? "text-orange" : "text-ink-2"
              }`}
            >
              <span>{formatScheduleDate(date, today)}</span>
              {isToday && (
                <span className="px-1.5 py-0.5 rounded-md bg-orange text-white text-[10px] font-mono">
                  TODAY
                </span>
              )}
              <span className="text-ink-3 font-normal font-mono">· {trades.length} 項</span>
            </div>
            {trades.map((trade) => (
              <ScheduleTradeCard
                key={trade.id}
                trade={{
                  id: trade.id,
                  name: trade.name,
                  crew: trade.crew,
                  status: trade.status,
                  projectId: trade.projectId,
                  projectName: trade.projectName,
                  isConflict: conflictIds.has(trade.id),
                  startDate: trade.start_date,
                }}
              />
            ))}
          </div>
        );
      })}

      {/* Unscheduled */}
      {unscheduled.length > 0 && (
        <div>
          <div className="mt-3 mx-4 mb-1 text-[12px] font-bold tracking-wider text-ink-3">
            未排定日期 · {unscheduled.length} 項
          </div>
          {unscheduled.map((trade) => (
            <ScheduleTradeCard
              key={trade.id}
              trade={{
                id: trade.id,
                name: trade.name,
                crew: trade.crew,
                status: trade.status,
                projectId: trade.projectId,
                projectName: trade.projectName,
                isConflict: false,
                startDate: trade.start_date,
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
