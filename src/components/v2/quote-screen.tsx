"use client";

import { useState } from "react";

import { getQuoteCost, getQuoteTotal } from "@/lib/v2-demo/store";

import { V2Icon } from "./icons";
import {
  SectionHeading,
  StatusBadge,
  V2Button,
  V2Card,
  formatDemoMoney,
} from "./primitives";
import type { DemoScreenProps } from "./screen-types";

export function QuoteScreen({ state, dispatch }: DemoScreenProps) {
  const [view, setView] = useState<"internal" | "customer">("internal");
  const total = getQuoteTotal(state);
  const cost = getQuoteCost(state);
  const margin = Math.round(((total - cost) / total) * 100);

  return (
    <div className="space-y-5">
      <header>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone={state.quote.status === "accepted" ? "green" : state.quote.status === "sent" ? "blue" : "neutral"}>
            {state.quote.status === "accepted"
              ? "客戶已接受"
              : state.quote.status === "sent"
                ? "已送出"
                : "草稿"}
          </StatusBadge>
          <span className="font-mono text-xs font-semibold text-ink-3">
            {state.quote.reference}・v{state.quote.version}
          </span>
        </div>
        <h1 className="mt-2 text-[27px] font-black tracking-[-0.04em] text-ink">報價人工確認</h1>
        <p className="mt-1 text-sm leading-6 text-ink-3">
          系統整理草稿；價格、範圍與對客內容一定由人確認後才送出。
        </p>
      </header>

      <div
        className="grid grid-cols-2 rounded-2xl border border-warm-border bg-white p-1"
        role="tablist"
        aria-label="切換報價視角"
      >
        <button
          type="button"
          role="tab"
          aria-selected={view === "internal"}
          onClick={() => setView("internal")}
          className={`min-h-11 rounded-xl text-sm font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange ${
            view === "internal" ? "bg-ink text-white" : "text-ink-3"
          }`}
        >
          店內確認版
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === "customer"}
          onClick={() => setView("customer")}
          className={`min-h-11 rounded-xl text-sm font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange ${
            view === "customer" ? "bg-orange text-white" : "text-ink-3"
          }`}
        >
          客戶看到的版本
        </button>
      </div>

      <V2Card className="overflow-hidden">
        <div className="border-b border-warm-border bg-[#fffaf3] p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-bold text-orange-deep">
                {view === "internal" ? "店內報價檢查" : "安心工程・客戶報價"}
              </p>
              <h2 className="mt-1 text-lg font-black text-ink">{state.caseRecord.title}</h2>
              <p className="mt-1 text-xs text-ink-3">報價有效至 {state.quote.validUntil}</p>
            </div>
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-orange-soft text-orange-deep">
              <V2Icon name={view === "internal" ? "shield" : "file"} className="h-5 w-5" />
            </span>
          </div>
        </div>

        <div className="divide-y divide-warm-border">
          {state.quote.lines.map((line) => (
            <div key={line.id} className="p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-black text-ink">{line.name}</p>
                  <p className="mt-1 text-xs leading-5 text-ink-3">{line.detail}</p>
                  <p className="mt-2 text-xs font-semibold text-ink-2">
                    {line.quantity} {line.unit} × {formatDemoMoney(line.unitPrice)}
                  </p>
                </div>
                <p className="shrink-0 font-mono text-sm font-black text-ink">
                  {formatDemoMoney(line.quantity * line.unitPrice)}
                </p>
              </div>
              {view === "internal" ? (
                <div className="mt-3 flex flex-wrap gap-2 rounded-xl bg-bg-warm px-3 py-2 text-[11px] font-semibold text-ink-2">
                  <span>內部成本 {formatDemoMoney(line.quantity * line.internalCost)}</span>
                  <span aria-hidden="true">・</span>
                  <span>此列毛利 {formatDemoMoney(line.quantity * (line.unitPrice - line.internalCost))}</span>
                </div>
              ) : null}
            </div>
          ))}
        </div>

        <div className="bg-ink p-5 text-white">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-xs font-semibold text-white/55">客戶確認總額</p>
              {view === "internal" ? (
                <p className="mt-1 text-[11px] text-white/55">
                  成本 {formatDemoMoney(cost)}・預估毛利 {margin}%
                </p>
              ) : (
                <p className="mt-1 text-[11px] text-white/55">含現場基本防護與服務紀錄</p>
              )}
            </div>
            <p className="font-mono text-2xl font-black tracking-tight">{formatDemoMoney(total)}</p>
          </div>
        </div>
      </V2Card>

      {view === "customer" ? (
        <V2Card className="p-5">
          <SectionHeading
            eyebrow="Customer message"
            title="服務範圍與說明"
            description={state.quote.customerMessage}
          />
          <div className="mt-4 flex items-center gap-2 rounded-xl bg-[var(--warm-green-soft)] px-3 py-2.5 text-xs font-bold text-[var(--warm-green)]">
            <V2Icon name="lock" className="h-4 w-4" />
            客戶版不載入成本、毛利與內部備註
          </div>
        </V2Card>
      ) : null}

      {state.quote.status === "draft" ? (
        <V2Card className="p-5">
          <SectionHeading
            eyebrow="Human checkpoint"
            title="送出前最後檢查"
            description="送出後會建立不可變版本；要修改只能建立新版本。"
          />
          <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-2xl border border-warm-border bg-[#fbf8f3] p-4 transition hover:border-orange/35">
            <input
              type="checkbox"
              checked={state.quote.humanConfirmed}
              onChange={(event) =>
                dispatch({ type: "SET_QUOTE_CONFIRMED", value: event.target.checked })
              }
              className="mt-0.5 h-5 w-5 rounded border-warm-border-strong accent-orange"
            />
            <span>
              <span className="block text-sm font-bold text-ink">
                我已檢查價格、範圍、效期與客戶版內容
              </span>
              <span className="mt-1 block text-xs leading-5 text-ink-3">
                這是示範人工閘門；AI 不會代替你勾選。
              </span>
            </span>
          </label>
          <V2Button
            className="mt-4 w-full"
            icon="send"
            onClick={() => dispatch({ type: "APPROVE_QUOTE" })}
          >
            核准並送出報價
          </V2Button>
        </V2Card>
      ) : null}

      {state.quote.status === "sent" ? (
        <V2Card className="p-5 text-center">
          <span className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-[20px] bg-[#e6effc] text-[#2e5f9f]">
            <V2Icon name="clock" className="h-6 w-6" />
          </span>
          <p className="mt-3 text-lg font-black text-ink">等待客戶確認</p>
          <p className="mt-1 text-xs leading-5 text-ink-3">
            報價已保存；就算通知失敗，這份商業資料也不會回退。
          </p>
          <V2Button
            className="mt-4 w-full"
            icon="check"
            onClick={() => dispatch({ type: "ACCEPT_QUOTE" })}
          >
            模擬客戶接受
          </V2Button>
        </V2Card>
      ) : null}

      {state.quote.status === "accepted" ? (
        <V2Card className="border-[var(--warm-green)]/20 bg-[var(--warm-green-soft)] p-5">
          <div className="flex items-start gap-3">
            <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white text-[var(--warm-green)]">
              <V2Icon name="check" />
            </span>
            <div>
              <p className="text-base font-black text-[var(--warm-green)]">客戶已接受 v{state.quote.version}</p>
              <p className="mt-1 text-xs leading-5 text-ink-2">確認版本與時間已保留，下一步安排工單。</p>
            </div>
          </div>
          <V2Button
            className="mt-4 w-full"
            icon="calendar"
            onClick={() => dispatch({ type: "NAVIGATE", step: "dispatch" })}
          >
            前往派工
          </V2Button>
        </V2Card>
      ) : null}
    </div>
  );
}

