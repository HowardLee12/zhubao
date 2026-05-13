"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { moveTrade } from "@/lib/actions";
import { shiftDays } from "@/lib/week";
import { Pill } from "@/components/ui/pill";
import type { CrewRow } from "@/lib/database.types";
import type { ScheduleTrade } from "./schedule-grid";

export function ScheduleConflictSheet({
  crewId,
  dateIso,
  trades,
  allCrews,
  onClose,
}: Readonly<{
  crewId: string | null;
  dateIso: string;
  trades: ScheduleTrade[];
  allCrews: CrewRow[];
  onClose: () => void;
}>) {
  const router = useRouter();
  const [working, setWorking] = useState(false);

  const crewName =
    crewId === null
      ? "未指定工班"
      : allCrews.find((c) => c.id === crewId)?.name ?? "未知工班";

  const reschedule = async (tradeId: string, projectId: string) => {
    setWorking(true);
    try {
      await moveTrade(tradeId, {
        crewId,
        startDate: shiftDays(dateIso, 1),
        projectId,
      });
      router.refresh();
      onClose();
    } finally {
      setWorking(false);
    }
  };

  const reassign = async (
    tradeId: string,
    projectId: string,
    newCrewId: string
  ) => {
    setWorking(true);
    try {
      await moveTrade(tradeId, {
        crewId: newCrewId,
        startDate: dateIso,
        projectId,
      });
      router.refresh();
      onClose();
    } finally {
      setWorking(false);
    }
  };

  const handleLineNotify = async () => {
    const dayShort = dateIso.slice(5).replace("-", "/");
    const lines = [
      `${crewName} 您好`,
      "",
      `${dayShort} 同時被排了 ${trades.length} 個工地，想跟您確認最終會去哪個：`,
      ...trades.map((t, i) => `${i + 1}. ${t.projectName} — ${t.name}`),
      "",
      "辛苦您回覆，謝謝！",
      "— Renoly",
    ];
    const text = lines.join("\n");
    if (navigator.share) {
      try {
        await navigator.share({
          title: `${dayShort} 工程確認`,
          text,
        });
      } catch {
        // user cancelled
      }
    } else {
      await navigator.clipboard?.writeText?.(text);
      globalThis.alert("訊息已複製到剪貼簿");
    }
  };

  const altCrew = allCrews.find((c) => c.id !== crewId);

  return (
    <>
      {/* Backdrop */}
      <button
        type="button"
        aria-label="關閉衝突視窗"
        onClick={onClose}
        className="fixed inset-0 bg-ink/40 z-40"
      />

      {/* Sheet */}
      <div
        className="fixed left-0 right-0 bottom-0 z-50 max-w-[430px] mx-auto bg-background rounded-t-3xl shadow-2xl"
        style={{ maxHeight: "85vh", overflowY: "auto" }}
      >
        <div className="mx-auto mt-2 mb-3 w-9 h-1 rounded-full bg-warm-border-strong" />

        <div className="px-4 pb-4">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-8 h-8 rounded-lg bg-[var(--warm-red)] text-white flex items-center justify-center">
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 3l10 18H2z" />
                <path d="M12 10v5M12 18v.01" />
              </svg>
            </div>
            <div className="text-lg font-bold text-[var(--warm-red)]">
              工班撞期
            </div>
          </div>
          <div className="text-[13px] text-ink-2">
            {crewName} · {dateIso.slice(5).replace("-", "/")} 同時被排了 {trades.length} 個工地
          </div>

          {/* Conflicting trades */}
          <div className="mt-3 space-y-2">
            {trades.map((t) => (
              <div
                key={t.id}
                className="bg-surface rounded-xl border border-warm-border p-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[14px] font-bold text-ink">
                      {t.name}
                    </div>
                    <div className="text-[11px] text-ink-3 mt-0.5 truncate">
                      {t.projectName}
                    </div>
                  </div>
                  <Pill variant="orange">{t.status === "active" ? "進行中" : "待排"}</Pill>
                </div>
              </div>
            ))}
          </div>

          {/* Suggested actions */}
          <div className="mt-4">
            <div className="text-[12px] font-semibold text-ink-2 tracking-wider mb-2">
              建議處理
            </div>

            <div className="space-y-1.5">
              {trades.length >= 2 && (
                <button
                  type="button"
                  disabled={working}
                  onClick={() =>
                    reschedule(trades[1].id, trades[1].projectId)
                  }
                  className="w-full bg-surface border border-warm-border rounded-xl px-3 py-3 flex items-center gap-3 active:scale-[0.99] transition-transform disabled:opacity-50"
                >
                  <div className="w-9 h-9 rounded-lg bg-orange-soft text-orange-deep flex items-center justify-center shrink-0">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="5" width="18" height="16" rx="2" />
                      <path d="M3 10h18M8 3v4M16 3v4" />
                    </svg>
                  </div>
                  <div className="flex-1 text-left min-w-0">
                    <div className="text-[13px] font-semibold text-ink">
                      把「{trades[1].name}」改到隔天
                    </div>
                    <div className="text-[11px] text-ink-3">
                      {shiftDays(dateIso, 1).slice(5).replace("-", "/")} 起改派 {crewName}
                    </div>
                  </div>
                </button>
              )}

              {altCrew && trades.length >= 2 && (
                <button
                  type="button"
                  disabled={working}
                  onClick={() =>
                    reassign(trades[1].id, trades[1].projectId, altCrew.id)
                  }
                  className="w-full bg-surface border border-warm-border rounded-xl px-3 py-3 flex items-center gap-3 active:scale-[0.99] transition-transform disabled:opacity-50"
                >
                  <div className="w-9 h-9 rounded-lg bg-orange-soft text-orange-deep flex items-center justify-center shrink-0">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 9h14l-3-3M21 15H7l3 3" />
                    </svg>
                  </div>
                  <div className="flex-1 text-left min-w-0">
                    <div className="text-[13px] font-semibold text-ink">
                      改派「{trades[1].name}」給 {altCrew.name}
                    </div>
                    <div className="text-[11px] text-ink-3">{altCrew.role || "未分類"}</div>
                  </div>
                </button>
              )}

              <button
                type="button"
                onClick={handleLineNotify}
                className="w-full bg-[#06C755] text-white rounded-xl px-3 py-3 flex items-center gap-3 active:scale-[0.99] transition-transform"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 3C6.5 3 2 6.7 2 11.2c0 3 2 5.7 5.2 7.1.2.1.5.3.6.5.1.2 0 .6 0 .9l-.2 1c-.1.3 0 .9.6.6.6-.3 3.4-2 4.6-2.9.7.1 1.4.1 2.2.1 5.5 0 10-3.7 10-8.3S17.5 3 12 3z" />
                </svg>
                <div className="flex-1 text-left">
                  <div className="text-[13px] font-bold">先用 LINE 跟師傅確認</div>
                  <div className="text-[11px] opacity-80">用系統手機分享傳訊息</div>
                </div>
              </button>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="w-full mt-3 mb-2 py-2.5 rounded-xl bg-surface border border-warm-border text-sm font-medium text-ink-2"
          >
            關閉
          </button>
        </div>
      </div>
    </>
  );
}
