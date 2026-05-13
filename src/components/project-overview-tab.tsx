"use client";

import Link from "next/link";
import Image from "next/image";
import { formatCurrency, formatCurrencyShort } from "@/lib/format";
import { mondayOf, weekDays, dateInRange } from "@/lib/week";
import { Pill } from "@/components/ui/pill";
import type { TradeRow, PaymentRow, PhotoRow } from "@/lib/database.types";

const WEEKDAY_ZH = ["日", "一", "二", "三", "四", "五", "六"];

export function ProjectOverviewTab({
  projectId,
  trades,
  payments,
  photos,
  photoUrls,
  conflictTradeIds,
  crewNamesById,
  onSwitchToTab,
}: Readonly<{
  projectId: string;
  trades: TradeRow[];
  payments: PaymentRow[];
  photos: PhotoRow[];
  photoUrls: Record<string, { thumbnail: string; full: string }>;
  conflictTradeIds: Set<string>;
  crewNamesById: Record<string, { name: string; role: string; phone: string }>;
  onSwitchToTab: (tab: "schedule" | "payment") => void;
}>) {
  const todayIso = new Date().toISOString().slice(0, 10);
  const weekStart = mondayOf(todayIso);
  const week = weekDays(weekStart, 6, todayIso);

  // Trades active this week
  const thisWeekTrades = trades
    .filter((t) =>
      week.some((d) => dateInRange(d.iso, t.start_date, t.end_date))
    )
    .sort((a, b) =>
      (a.start_date ?? "9999").localeCompare(b.start_date ?? "9999")
    );

  // Payment summary
  const paid = payments
    .filter((p) => p.status === "paid")
    .reduce((s, p) => s + p.amount, 0);
  const due = payments
    .filter((p) => p.status !== "paid")
    .reduce((s, p) => s + p.amount, 0);
  const total = paid + due;

  // Sort payments by sort_order for the proportional bar
  const sortedPayments = [...payments].sort((a, b) => a.sort_order - b.sort_order);

  // Last 6 photos
  const recentPhotos = photos.slice(0, 6);

  return (
    <div className="space-y-4">
      {/* This week's trades */}
      <section>
        <div className="flex items-baseline justify-between px-1 mb-2">
          <div className="text-[13px] font-semibold text-ink-2 tracking-wider">
            本週工班 · {thisWeekTrades.length} 班
          </div>
          <button
            type="button"
            onClick={() => onSwitchToTab("schedule")}
            className="text-[12px] text-orange font-medium"
          >
            排程 ›
          </button>
        </div>

        {thisWeekTrades.length === 0 ? (
          <div className="bg-surface-warm rounded-2xl border border-warm-border px-4 py-6 text-center">
            <div className="text-[13px] text-ink-2 mb-1">本週無排定工程</div>
            <button
              type="button"
              onClick={() => onSwitchToTab("schedule")}
              className="text-[12px] text-orange font-semibold"
            >
              去新增工種 →
            </button>
          </div>
        ) : (
          <div className="bg-surface rounded-2xl border border-warm-border divide-y divide-warm-border">
            {thisWeekTrades.map((trade) => {
              const startDate = trade.start_date
                ? new Date(`${trade.start_date}T00:00:00`)
                : null;
              const isConflict = conflictTradeIds.has(trade.id);
              const crew = trade.crew_id ? crewNamesById[trade.crew_id] : undefined;
              const crewLabel = crew
                ? `${crew.name}${crew.role ? ` · ${crew.role}` : ""}${crew.phone ? `   ${crew.phone}` : ""}`
                : trade.crew || "未指定工班";

              return (
                <div key={trade.id} className="flex items-center gap-3 px-4 py-3">
                  {/* Date column */}
                  <div className="text-center min-w-[40px]">
                    {startDate ? (
                      <>
                        <div className="text-[10px] text-ink-3 font-mono">
                          {startDate.getMonth() + 1}月
                        </div>
                        <div className="text-[19px] font-bold text-ink leading-tight font-mono tabular-nums">
                          {startDate.getDate()}
                        </div>
                      </>
                    ) : (
                      <div className="text-[11px] text-ink-3">待排</div>
                    )}
                  </div>

                  <div className="w-px h-9 bg-warm-border shrink-0" />

                  <div className="flex-1 min-w-0">
                    <div className="text-[14px] font-bold text-ink leading-tight">
                      {trade.name}
                    </div>
                    <div className="text-[11px] text-ink-3 mt-0.5 truncate">
                      {crewLabel}
                    </div>
                  </div>

                  {isConflict && (
                    <Pill variant="red" className="shrink-0">
                      撞期
                    </Pill>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Payment summary mini */}
      <section>
        <div className="flex items-baseline justify-between px-1 mb-2">
          <div className="text-[13px] font-semibold text-ink-2 tracking-wider">
            收款狀況
          </div>
          {payments.length > 0 && (
            <button
              type="button"
              onClick={() => onSwitchToTab("payment")}
              className="text-[12px] text-orange font-medium"
            >
              明細 ›
            </button>
          )}
        </div>

        {payments.length === 0 ? (
          <div className="bg-surface-warm rounded-2xl border border-warm-border px-4 py-6 text-center">
            <div className="text-[13px] text-ink-2 mb-1">尚未新增收款期數</div>
            <button
              type="button"
              onClick={() => onSwitchToTab("payment")}
              className="text-[12px] text-orange font-semibold"
            >
              去新增 →
            </button>
          </div>
        ) : (
          <div className="bg-surface rounded-2xl border border-warm-border p-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-[11px] text-ink-3">已收</div>
                <div className="font-mono text-xl font-bold text-[var(--warm-green)] tabular-nums">
                  {formatCurrency(paid)}
                </div>
              </div>
              <div className="text-right">
                <div className="text-[11px] text-ink-3">待收</div>
                <div className="font-mono text-xl font-bold text-orange tabular-nums">
                  {formatCurrency(due)}
                </div>
              </div>
            </div>

            {/* Proportional payment bar */}
            {total > 0 && (
              <>
                <div className="flex h-2 rounded-full overflow-hidden bg-bg-warm mt-3">
                  {sortedPayments.map((p) => (
                    <div
                      key={p.id}
                      className={
                        p.status === "paid"
                          ? "bg-[var(--warm-green)]"
                          : "bg-orange-soft"
                      }
                      style={{ width: `${(p.amount / total) * 100}%` }}
                    />
                  ))}
                </div>

                <div className="flex gap-1 mt-2 text-[10px] font-mono tabular-nums">
                  {sortedPayments.map((p) => (
                    <span
                      key={p.id}
                      className={
                        p.status === "paid" ? "text-[var(--warm-green)]" : "text-orange-deep"
                      }
                      style={{ flexBasis: `${(p.amount / total) * 100}%` }}
                    >
                      {p.name} {p.percentage}%
                    </span>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </section>

      {/* Recent photos */}
      <section>
        <div className="flex items-baseline justify-between px-1 mb-2">
          <div className="text-[13px] font-semibold text-ink-2 tracking-wider">
            最近現場照片
          </div>
        </div>

        {recentPhotos.length === 0 ? (
          <div className="bg-surface-warm rounded-2xl border border-warm-border px-4 py-6 text-center text-[13px] text-ink-2">
            還沒上傳照片
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-1.5">
            {recentPhotos.map((photo) => {
              const url = photoUrls[photo.id]?.thumbnail;
              return (
                <Link
                  key={photo.id}
                  href={`/projects/${projectId}#photos`}
                  className="block aspect-square rounded-lg overflow-hidden bg-bg-warm border border-warm-border relative"
                >
                  {url && (
                    <Image
                      src={url}
                      alt={photo.caption || "施工照片"}
                      fill
                      sizes="(max-width: 430px) 33vw, 140px"
                      className="object-cover"
                      unoptimized
                    />
                  )}
                </Link>
              );
            })}
          </div>
        )}
        <div className="mt-1 text-right">
          <div className="text-[11px] text-ink-3">
            共 {photos.length} 張 · 完整相簿請至「排程」分頁的照片區
          </div>
        </div>
      </section>

      {/* Total summary footer */}
      {total > 0 && (
        <div className="text-[10px] text-ink-3 text-center pb-2">
          應收 {formatCurrencyShort(total)} · 餘額 {formatCurrencyShort(due)}
        </div>
      )}
    </div>
  );
}
