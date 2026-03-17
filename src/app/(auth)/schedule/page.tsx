import { getProjects } from "@/lib/queries";
import { formatDate } from "@/lib/format";
import { ScheduleTradeCard } from "@/components/schedule-trade-card";

export const dynamic = "force-dynamic";

export default async function SchedulePage() {
  const projects = await getProjects();

  const allTrades = projects.flatMap((p) =>
    p.trades.map((t) => ({
      ...t,
      projectId: p.id,
      projectName: `${p.customer_name} ${p.address}`,
    }))
  );

  // Group trades by start_date
  const tradesByDate = allTrades
    .filter((t) => t.start_date)
    .sort((a, b) => (a.start_date ?? "").localeCompare(b.start_date ?? ""))
    .reduce<Record<string, typeof allTrades>>((acc, trade) => {
      const date = trade.start_date ?? "";
      return { ...acc, [date]: [...(acc[date] ?? []), trade] };
    }, {});

  const activeTrades = allTrades.filter((t) => t.status === "active").length;

  // Detect conflicts (same crew on same date)
  const dateCrewMap = new Map<string, string[]>();
  for (const trade of allTrades) {
    if (!trade.start_date || !trade.crew) continue;
    const key = `${trade.start_date}-${trade.crew}`;
    const existing = dateCrewMap.get(key) ?? [];
    dateCrewMap.set(key, [...existing, trade.id]);
  }
  const conflictTradeIds = new Set(
    Array.from(dateCrewMap.values())
      .filter((ids) => ids.length > 1)
      .flat()
  );

  const unscheduledTrades = allTrades.filter((t) => !t.start_date);

  return (
    <div>
      <header className="bg-primary text-primary-foreground px-4 py-3">
        <div className="text-lg font-bold">工班排程</div>
        <div className="text-xs opacity-80">進行中工種：{activeTrades} 項</div>
      </header>

      {Object.keys(tradesByDate).length === 0 && unscheduledTrades.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          <div className="text-sm">還沒有排程</div>
          <div className="text-xs mt-1">從案件中新增工種排程</div>
        </div>
      )}

      {Object.entries(tradesByDate).map(([date, trades]) => {
        const today = new Date().toISOString().split("T")[0];
        const dateLabel = date === today
          ? `今天 — ${formatDate(date)}`
          : formatDate(date);

        return (
          <div key={date}>
            <div className="px-4 py-2.5 text-[13px] font-semibold text-sage-700 bg-sage-100">
              {dateLabel}
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
                  isConflict: conflictTradeIds.has(trade.id),
                }}
              />
            ))}
          </div>
        );
      })}

      {/* Unscheduled trades */}
      {unscheduledTrades.length > 0 && (
        <div>
          <div className="px-4 py-2.5 text-[13px] font-semibold text-sage-700 bg-sage-100">
            未排定日期
          </div>
          {unscheduledTrades.map((trade) => (
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
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
