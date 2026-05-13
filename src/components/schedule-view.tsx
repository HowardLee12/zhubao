"use client";

import { useState } from "react";
import { ScheduleGrid, type ScheduleTrade } from "@/components/schedule-grid";
import { ScheduleConflictSheet } from "@/components/schedule-conflict-sheet";
import { ScheduleTradeCard } from "@/components/schedule-trade-card";
import { Pill } from "@/components/ui/pill";
import { formatScheduleDate } from "@/lib/format";
import type { CrewRow } from "@/lib/database.types";

export type ScheduleData = {
  trades: ScheduleTrade[];
  crews: CrewRow[];
  projects: { id: string; customer_name: string; address: string; description: string }[];
  today: string;
  conflictIds: string[];
};

type ConflictTarget = {
  crewId: string | null;
  dateIso: string;
  trades: ScheduleTrade[];
};

function groupByDate(trades: ScheduleTrade[]): Record<string, ScheduleTrade[]> {
  return trades
    .filter((t) => t.start_date)
    .sort((a, b) => (a.start_date ?? "").localeCompare(b.start_date ?? ""))
    .reduce<Record<string, ScheduleTrade[]>>((acc, trade) => {
      const date = trade.start_date ?? "";
      return { ...acc, [date]: [...(acc[date] ?? []), trade] };
    }, {});
}

function resolveCrewName(
  trade: { crew: string; crew_id: string | null },
  crewsById: Record<string, { name: string }>
): string {
  if (trade.crew_id && crewsById[trade.crew_id]) {
    return crewsById[trade.crew_id].name;
  }
  return trade.crew;
}

export function ScheduleView({ data }: Readonly<{ data: ScheduleData }>) {
  const [view, setView] = useState<"list" | "grid">("list");
  const [conflict, setConflict] = useState<ConflictTarget | null>(null);

  const conflictSet = new Set(data.conflictIds);
  const tradesByDate = groupByDate(data.trades);
  const unscheduled = data.trades.filter((t) => !t.start_date);
  const crewsById: Record<string, { name: string }> = {};
  for (const c of data.crews) crewsById[c.id] = { name: c.name };

  return (
    <>
      {/* View toggle */}
      <div className="px-4 mt-1 mb-2">
        <div className="flex gap-1 p-1 bg-bg-warm rounded-xl">
          <button
            type="button"
            onClick={() => setView("list")}
            className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              view === "list"
                ? "bg-surface text-orange shadow-sm"
                : "text-ink-3"
            }`}
          >
            列表
          </button>
          <button
            type="button"
            onClick={() => setView("grid")}
            className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              view === "grid"
                ? "bg-surface text-orange shadow-sm"
                : "text-ink-3"
            }`}
          >
            工班 × 週 網格
          </button>
        </div>
      </div>

      {view === "grid" ? (
        <ScheduleGrid
          trades={data.trades}
          crews={data.crews}
          projectIds={data.projects.map((p) => p.id)}
          onSelectConflict={(cellKey, trades) => {
            const [rowKey, dateIso] = cellKey.split("|");
            setConflict({
              crewId: rowKey === "__none__" ? null : rowKey,
              dateIso,
              trades,
            });
          }}
        />
      ) : (
        <ListView
          data={data}
          tradesByDate={tradesByDate}
          unscheduled={unscheduled}
          conflictSet={conflictSet}
          crewsById={crewsById}
          onSelectConflict={(crewId, dateIso, trades) =>
            setConflict({ crewId, dateIso, trades })
          }
        />
      )}

      {conflict && (
        <ScheduleConflictSheet
          crewId={conflict.crewId}
          dateIso={conflict.dateIso}
          trades={conflict.trades}
          allCrews={data.crews}
          onClose={() => setConflict(null)}
        />
      )}
    </>
  );
}

function TradeRow({
  trade,
  isConflict,
  crewsById,
  onConflictClick,
}: Readonly<{
  trade: ScheduleTrade;
  isConflict: boolean;
  crewsById: Record<string, { name: string }>;
  onConflictClick: () => void;
}>) {
  const cardProps = {
    id: trade.id,
    name: trade.name,
    crew: resolveCrewName(trade, crewsById),
    status: trade.status,
    projectId: trade.projectId,
    projectName: trade.projectName,
    isConflict,
    startDate: trade.start_date,
  };

  if (!isConflict) {
    return <ScheduleTradeCard trade={cardProps} />;
  }

  return (
    <button
      type="button"
      onClick={onConflictClick}
      className="block w-full text-left"
      aria-label={`處理「${trade.name}」衝突`}
    >
      <ScheduleTradeCard trade={cardProps} />
    </button>
  );
}

function ListView({
  data,
  tradesByDate,
  unscheduled,
  conflictSet,
  crewsById,
  onSelectConflict,
}: Readonly<{
  data: ScheduleData;
  tradesByDate: Record<string, ScheduleTrade[]>;
  unscheduled: ScheduleTrade[];
  conflictSet: Set<string>;
  crewsById: Record<string, { name: string }>;
  onSelectConflict: (
    crewId: string | null,
    dateIso: string,
    trades: ScheduleTrade[]
  ) => void;
}>) {
  if (Object.keys(tradesByDate).length === 0 && unscheduled.length === 0) {
    return (
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
    );
  }

  return (
    <>
      {Object.entries(tradesByDate).map(([date, trades]) => {
        const isToday = date === data.today;
        return (
          <div key={date}>
            <div
              className={`mt-3 mx-4 mb-1 flex items-center gap-2 text-[12px] font-bold tracking-wider ${
                isToday ? "text-orange" : "text-ink-2"
              }`}
            >
              <span>{formatScheduleDate(date, data.today)}</span>
              {isToday && (
                <Pill variant="orange" className="!font-mono">
                  TODAY
                </Pill>
              )}
              <span className="text-ink-3 font-normal font-mono">· {trades.length} 項</span>
            </div>
            {trades.map((trade) => (
              <TradeRow
                key={trade.id}
                trade={trade}
                isConflict={conflictSet.has(trade.id)}
                crewsById={crewsById}
                onConflictClick={() => {
                  const sameCrew = (a: ScheduleTrade) =>
                    (a.crew_id ?? "__none__") === (trade.crew_id ?? "__none__");
                  const sameDayTrades = trades.filter(sameCrew);
                  onSelectConflict(trade.crew_id, date, sameDayTrades);
                }}
              />
            ))}
          </div>
        );
      })}

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
                crew: resolveCrewName(trade, crewsById),
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
    </>
  );
}
