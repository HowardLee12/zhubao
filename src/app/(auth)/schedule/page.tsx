import { getProjects, getCrews } from "@/lib/queries";
import { TopBar } from "@/components/ui/top-bar";
import { Pill } from "@/components/ui/pill";
import { ScheduleView, type ScheduleData } from "@/components/schedule-view";
import type { ScheduleTrade } from "@/components/schedule-grid";

export const dynamic = "force-dynamic";

function detectConflicts(trades: ScheduleTrade[]): Set<string> {
  // Same crew_id (or unassigned) on the same start_date with >1 trades.
  const dateCrewMap = new Map<string, string[]>();
  for (const t of trades) {
    if (!t.start_date) continue;
    const crewKey = t.crew_id ?? (t.crew?.trim() ? `name:${t.crew}` : "__none__");
    const key = `${t.start_date}::${crewKey}`;
    const existing = dateCrewMap.get(key) ?? [];
    dateCrewMap.set(key, [...existing, t.id]);
  }
  return new Set(
    Array.from(dateCrewMap.values())
      .filter((ids) => ids.length > 1)
      .flat()
  );
}

export default async function SchedulePage() {
  const [projects, crews] = await Promise.all([getProjects(), getCrews()]);
  const today = new Date().toISOString().slice(0, 10);

  const allTrades: ScheduleTrade[] = projects.flatMap((p) =>
    p.trades.map((t) => ({
      ...t,
      projectId: p.id,
      projectName: `${p.customer_name} · ${p.description || p.address}`,
    }))
  );

  const conflictIds = detectConflicts(allTrades);
  const activeCount = allTrades.filter((t) => t.status === "active").length;

  const data: ScheduleData = {
    trades: allTrades,
    crews,
    projects: projects.map((p) => ({
      id: p.id,
      customer_name: p.customer_name,
      address: p.address,
      description: p.description,
    })),
    today,
    conflictIds: Array.from(conflictIds),
  };

  const scheduledDays = new Set(
    allTrades.filter((t) => t.start_date).map((t) => t.start_date as string)
  ).size;

  return (
    <div className="pb-24">
      <TopBar
        title="工班排程"
        subtitle={
          <span>
            {scheduledDays} 個工作日
            {activeCount > 0 ? ` · 進行中 ${activeCount} 項` : ""}
          </span>
        }
        right={
          conflictIds.size > 0 ? (
            <Pill variant="red">{conflictIds.size} 衝突</Pill>
          ) : undefined
        }
      />

      {conflictIds.size > 0 && (
        <div className="mx-4 mt-1 mb-1 px-3 py-2.5 rounded-xl bg-[var(--warm-red-soft)] border border-[var(--warm-red)]/30 flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-[var(--warm-red)] text-white flex items-center justify-center shrink-0">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3l10 18H2z" />
              <path d="M12 10v5M12 18v.01" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[12px] font-bold text-[var(--warm-red)]">
              偵測到 {conflictIds.size} 個師傅撞期
            </div>
            <div className="text-[11px] text-ink-2 mt-0.5">
              點擊任一衝突工程開啟處理面板（改派 / 改日 / LINE 通知）
            </div>
          </div>
        </div>
      )}

      <ScheduleView data={data} />
    </div>
  );
}
