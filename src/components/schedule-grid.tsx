"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { moveTrade } from "@/lib/actions";
import { mondayOf, shiftDays, weekDays, weekNumberOf, dateInRange } from "@/lib/week";
import type { CrewRow, TradeRow } from "@/lib/database.types";

export type ScheduleTrade = TradeRow & {
  projectName: string;
  projectId: string;
};

type DragState = {
  tradeId: string;
  x: number;
  y: number;
  offX: number;
  offY: number;
  w: number;
  h: number;
  trade: ScheduleTrade;
};

const PROJECT_COLORS = [
  { bg: "bg-orange", text: "text-white", hex: "#E2691F" },
  { bg: "bg-brick", text: "text-white", hex: "#A04428" },
  { bg: "bg-ink", text: "text-white", hex: "#1A1410" },
  { bg: "bg-[var(--amber)]", text: "text-white", hex: "#C88B1A" },
];

function colorForProject(projectId: string, projectIds: string[]) {
  const idx = projectIds.indexOf(projectId);
  return PROJECT_COLORS[idx % PROJECT_COLORS.length];
}

function DragGhost({
  drag,
  projectIds,
}: Readonly<{ drag: DragState; projectIds: string[] }>) {
  const color = colorForProject(drag.trade.projectId, projectIds);
  return (
    <div
      className="fixed pointer-events-none z-50 rounded-md px-1.5 py-1 opacity-85 shadow-lg"
      style={{
        left: drag.x - drag.offX,
        top: drag.y - drag.offY,
        width: drag.w,
        height: drag.h,
        background: color.hex,
        color: "white",
      }}
    >
      <div className="text-[10px] font-bold leading-tight truncate">
        {drag.trade.name}
      </div>
    </div>
  );
}

export function ScheduleGrid({
  trades,
  crews,
  projectIds,
  initialWeekStart,
  onSelectConflict,
}: Readonly<{
  trades: ScheduleTrade[];
  crews: CrewRow[];
  projectIds: string[];
  initialWeekStart?: string;
  onSelectConflict?: (cellKey: string, trades: ScheduleTrade[]) => void;
}>) {
  const router = useRouter();
  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [weekStart, setWeekStart] = useState(() =>
    initialWeekStart ?? mondayOf(todayIso)
  );
  const [drag, setDrag] = useState<DragState | null>(null);
  const [hoverCell, setHoverCell] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const days = useMemo(() => weekDays(weekStart, 6, todayIso), [weekStart, todayIso]);

  // Crews list + virtual "unassigned" row
  const rows = useMemo(
    () => [
      { id: "__none__", name: "未指定", role: "" },
      ...crews,
    ],
    [crews]
  );

  // Bucket trades by (rowKey, dateIso)
  const cells = useMemo(() => {
    const map = new Map<string, ScheduleTrade[]>();
    for (const t of trades) {
      const rowKey = t.crew_id ?? "__none__";
      for (const d of days) {
        if (!dateInRange(d.iso, t.start_date, t.end_date)) continue;
        const k = `${rowKey}|${d.iso}`;
        map.set(k, [...(map.get(k) ?? []), t]);
      }
    }
    return map;
  }, [trades, days]);

  // Drag handlers (pointer events for both mouse and touch)
  const onPointerDown = (e: React.PointerEvent, trade: ScheduleTrade) => {
    e.preventDefault();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setDrag({
      tradeId: trade.id,
      x: e.clientX,
      y: e.clientY,
      offX: e.clientX - rect.left,
      offY: e.clientY - rect.top,
      w: rect.width,
      h: rect.height,
      trade,
    });
  };

  useEffect(() => {
    if (!drag) return;
    const move = (e: PointerEvent) => {
      setDrag((d) => (d ? { ...d, x: e.clientX, y: e.clientY } : null));
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const cell = el?.closest?.("[data-cell]");
      setHoverCell((cell as HTMLElement | null)?.dataset.cell ?? null);
    };
    const up = async (e: PointerEvent) => {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const cell = el?.closest?.("[data-cell]");
      const cellKey = (cell as HTMLElement | null)?.dataset.cell;
      const tradeToMove = drag.trade;
      setDrag(null);
      setHoverCell(null);
      if (cellKey) {
        const [rowKey, dateIso] = cellKey.split("|");
        const sameCrew =
          (tradeToMove.crew_id ?? "__none__") === rowKey;
        const sameDate = tradeToMove.start_date === dateIso;
        if (sameCrew && sameDate) return;
        const newCrewId = rowKey === "__none__" ? null : rowKey;

        setPending(true);
        try {
          await moveTrade(tradeToMove.id, {
            crewId: newCrewId,
            startDate: dateIso,
            projectId: tradeToMove.projectId,
          });
          router.refresh();
        } finally {
          setPending(false);
        }
      }
    };
    globalThis.addEventListener("pointermove", move);
    globalThis.addEventListener("pointerup", up);
    globalThis.addEventListener("pointercancel", up);
    return () => {
      globalThis.removeEventListener("pointermove", move);
      globalThis.removeEventListener("pointerup", up);
      globalThis.removeEventListener("pointercancel", up);
    };
  }, [drag, router]);

  const goPrevWeek = () => setWeekStart((w) => shiftDays(w, -7));
  const goNextWeek = () => setWeekStart((w) => shiftDays(w, 7));
  const goThisWeek = () => setWeekStart(mondayOf(todayIso));

  return (
    <div className="px-3">
      {/* Week navigator */}
      <div className="flex items-center justify-between py-2">
        <button
          type="button"
          onClick={goPrevWeek}
          aria-label="前一週"
          className="w-8 h-8 rounded-full bg-surface border border-warm-border flex items-center justify-center text-ink-2"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <button
          type="button"
          onClick={goThisWeek}
          className="text-[13px] font-bold text-ink font-mono"
        >
          {new Date(`${weekStart}T00:00:00`).getFullYear()} · 第 {weekNumberOf(weekStart)} 週
        </button>
        <button
          type="button"
          onClick={goNextWeek}
          aria-label="下一週"
          className="w-8 h-8 rounded-full bg-surface border border-warm-border flex items-center justify-center text-ink-2"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 6l6 6-6 6" />
          </svg>
        </button>
      </div>

      {/* Grid */}
      <div className="bg-surface rounded-2xl border border-warm-border overflow-hidden">
        {/* Header row */}
        <div
          className="grid bg-bg-warm border-b border-warm-border"
          style={{ gridTemplateColumns: `64px repeat(${days.length}, 1fr)` }}
        >
          <div className="border-r border-warm-border" />
          {days.map((d) => (
            <div
              key={d.iso}
              className={`text-center py-2 border-r border-warm-border last:border-r-0 ${
                d.isToday ? "bg-orange text-white" : "text-ink-2"
              }`}
            >
              <div className="text-[9px] opacity-75">週{d.weekday}</div>
              <div className="text-sm font-bold font-mono">{d.date}</div>
            </div>
          ))}
        </div>

        {/* Crew rows */}
        {rows.map((crew) => (
          <div
            key={crew.id}
            className="grid border-b border-warm-border last:border-b-0"
            style={{ gridTemplateColumns: `64px repeat(${days.length}, 1fr)`, minHeight: 64 }}
          >
            <div className="border-r border-warm-border bg-surface-warm p-1.5 flex flex-col justify-center">
              <div className="text-[12px] font-bold text-ink truncate">{crew.name}</div>
              {crew.role && (
                <div className="text-[10px] text-ink-3 truncate">{crew.role}</div>
              )}
            </div>

            {days.map((d) => {
              const cellKey = `${crew.id}|${d.iso}`;
              const cellTrades = cells.get(cellKey) ?? [];
              const isHover = hoverCell === cellKey;
              const hasConflict = cellTrades.length > 1;

              return (
                <div
                  key={d.iso}
                  data-cell={cellKey}
                  className={`relative border-r border-warm-border last:border-r-0 p-1 ${
                    d.isWeekend ? "bg-bg-warm/30" : ""
                  } ${isHover ? "bg-orange-soft" : ""}`}
                  style={{ minHeight: 64 }}
                >
                  {cellTrades.map((t, i) => {
                    const color = colorForProject(t.projectId, projectIds);
                    const isDragging = drag?.tradeId === t.id;
                    const stackOffset = cellTrades.length > 1 ? i * 3 : 0;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onPointerDown={(e) => onPointerDown(e, t)}
                        onClick={(e) => {
                          if (hasConflict) {
                            e.stopPropagation();
                            onSelectConflict?.(cellKey, cellTrades);
                          }
                        }}
                        className={`absolute rounded-md px-1.5 py-1 text-left ${color.bg} ${color.text} ${
                          isDragging ? "opacity-30" : ""
                        } ${hasConflict ? "ring-2 ring-[var(--warm-red)] ring-offset-1 ring-offset-surface" : ""}`}
                        style={{
                          top: 4 + stackOffset,
                          left: 4 + stackOffset,
                          right: Math.max(4 - stackOffset, 0),
                          bottom: Math.max(4 - stackOffset, 0),
                          zIndex: cellTrades.length - i,
                          touchAction: "none",
                          cursor: "grab",
                          userSelect: "none",
                        }}
                      >
                        <div className="text-[10px] font-bold leading-tight truncate">
                          {t.name}
                        </div>
                        <div className="text-[9px] opacity-80 truncate">
                          {t.projectName.split("·")[0].trim()}
                        </div>
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-2 px-1 py-2 text-[10px] text-ink-3">
        <span>← 長按拖移 · 釋放到目標格子改派 / 改日</span>
        {pending && <span className="text-orange">儲存中…</span>}
      </div>

      {/* Drag ghost */}
      {drag && (
        <DragGhost drag={drag} projectIds={projectIds} />
      )}
    </div>
  );
}
