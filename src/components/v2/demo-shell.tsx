"use client";

import type { Dispatch, ReactNode } from "react";

import { getCaseStage } from "@/lib/v2-demo/store";
import type { DemoAction, DemoState, DemoStep } from "@/lib/v2-demo/types";

import { V2Icon, type V2IconName } from "./icons";
import { StatusBadge, V2Button } from "./primitives";

const flowSteps: Array<{ id: DemoStep; label: string; shortLabel: string; icon: V2IconName }> = [
  { id: "inbox", label: "接案匣", shortLabel: "接案", icon: "inbox" },
  { id: "case", label: "案件整理", shortLabel: "案件", icon: "briefcase" },
  { id: "quote", label: "報價確認", shortLabel: "報價", icon: "quote" },
  { id: "dispatch", label: "排程派工", shortLabel: "派工", icon: "calendar" },
  { id: "field", label: "技師現場", shortLabel: "現場", icon: "wrench" },
  { id: "complete", label: "完工摘要", shortLabel: "完工", icon: "check" },
];

const mobileSteps = flowSteps.filter((step) =>
  ["inbox", "case", "dispatch", "field"].includes(step.id),
);

function BrandMark() {
  return (
    <div className="flex items-center gap-3">
      <span className="relative inline-flex h-10 w-10 items-center justify-center overflow-hidden rounded-[14px] bg-ink text-white shadow-lg shadow-black/10">
        <span className="absolute -right-2 -top-2 h-6 w-6 rounded-full bg-orange" />
        <span className="relative text-lg font-black tracking-[-0.08em]">R</span>
      </span>
      <span>
        <span className="block text-base font-black tracking-tight text-ink">Renoly</span>
        <span className="block text-[10px] font-semibold tracking-[0.12em] text-ink-3">
          FIELD WORKSPACE
        </span>
      </span>
    </div>
  );
}

function TemplateSwitch({ state, dispatch }: ShellProps) {
  return (
    <div>
      <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-ink-3">
        產業模板
      </p>
      <div className="grid grid-cols-2 gap-1 rounded-2xl bg-bg-warm p-1" role="group" aria-label="選擇示範模板">
        <button
          type="button"
          aria-pressed={state.template === "service"}
          onClick={() => dispatch({ type: "SWITCH_TEMPLATE", template: "service" })}
          className={`min-h-11 rounded-xl px-3 text-xs font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange ${
            state.template === "service"
              ? "bg-white text-orange-deep shadow-sm"
              : "text-ink-3 hover:text-ink"
          }`}
        >
          到府服務
        </button>
        <button
          type="button"
          aria-pressed={state.template === "project"}
          onClick={() => dispatch({ type: "SWITCH_TEMPLATE", template: "project" })}
          className={`min-h-11 rounded-xl px-3 text-xs font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange ${
            state.template === "project"
              ? "bg-white text-orange-deep shadow-sm"
              : "text-ink-3 hover:text-ink"
          }`}
        >
          小型工程
        </button>
      </div>
    </div>
  );
}

function DesktopSidebar({ state, dispatch }: ShellProps) {
  return (
    <aside className="sticky top-0 hidden h-dvh flex-col border-r border-warm-border bg-[#fffaf3]/90 px-4 py-5 backdrop-blur-xl md:flex">
      <div className="px-2">
        <BrandMark />
      </div>

      <div className="mt-7 px-1">
        <TemplateSwitch state={state} dispatch={dispatch} />
      </div>

      <nav aria-label="示範流程" className="mt-7 space-y-1">
        <p className="mb-2 px-3 text-[10px] font-bold uppercase tracking-[0.16em] text-ink-3">
          接案到完工
        </p>
        {flowSteps.map((step, index) => {
          const active = step.id === state.currentStep;
          return (
            <button
              key={step.id}
              type="button"
              aria-current={active ? "step" : undefined}
              onClick={() => dispatch({ type: "NAVIGATE", step: step.id })}
              className={`flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange ${
                active
                  ? "bg-ink text-white shadow-lg shadow-black/10"
                  : "text-ink-2 hover:bg-bg-warm hover:text-ink"
              }`}
            >
              <span
                className={`inline-flex h-7 w-7 items-center justify-center rounded-lg text-xs font-bold ${
                  active ? "bg-orange text-white" : "bg-white text-ink-3"
                }`}
              >
                {index + 1}
              </span>
              <span className="flex-1">{step.label}</span>
              <V2Icon name={step.icon} className="h-4 w-4 opacity-75" />
            </button>
          );
        })}
      </nav>

      <div className="mt-auto rounded-2xl border border-orange/15 bg-orange-soft/70 p-3.5">
        <div className="flex items-center gap-2 text-xs font-bold text-orange-deep">
          <V2Icon name="shield" className="h-4 w-4" />
          本地互動資料
        </div>
        <p className="mt-1.5 text-[11px] leading-5 text-ink-2">
          這個原型不會連線資料庫，也不會真的發出 LINE 通知。
        </p>
      </div>
    </aside>
  );
}

function FlowRail({ state, dispatch }: ShellProps) {
  const activeIndex = flowSteps.findIndex((step) => step.id === state.currentStep);

  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:px-0">
      <ol className="flex min-w-max items-center gap-1" aria-label="目前示範進度">
        {flowSteps.map((step, index) => {
          const active = step.id === state.currentStep;
          const visited = index < activeIndex;
          return (
            <li key={step.id} className="flex items-center">
              <button
                type="button"
                aria-current={active ? "step" : undefined}
                onClick={() => dispatch({ type: "NAVIGATE", step: step.id })}
                className={`inline-flex min-h-9 items-center gap-2 rounded-full px-3 text-xs font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange ${
                  active
                    ? "bg-ink text-white"
                    : visited
                      ? "bg-[var(--warm-green-soft)] text-[var(--warm-green)]"
                      : "bg-white text-ink-3"
                }`}
              >
                <span
                  className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] ${
                    active ? "bg-orange" : visited ? "bg-white/70" : "bg-bg-warm"
                  }`}
                >
                  {visited ? <V2Icon name="check" className="h-3 w-3" /> : index + 1}
                </span>
                {step.shortLabel}
              </button>
              {index < flowSteps.length - 1 ? (
                <span aria-hidden="true" className="mx-1 h-px w-3 bg-warm-border" />
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function ContextRail({ state }: Pick<ShellProps, "state">) {
  return (
    <aside className="sticky top-24 hidden self-start xl:block" aria-label="案件上下文">
      <div className="rounded-[24px] border border-warm-border bg-white p-5 shadow-[0_14px_40px_rgba(74,45,20,0.06)]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-ink-3">
              即時案件脈絡
            </p>
            <p className="mt-1 text-sm font-bold text-ink">{state.caseRecord.reference}</p>
          </div>
          <StatusBadge tone="orange">{getCaseStage(state)}</StatusBadge>
        </div>
        <div className="mt-5 space-y-4">
          {[...state.timeline].reverse().slice(0, 5).map((event, index) => (
            <div key={event.id} className="relative flex gap-3">
              {index < Math.min(state.timeline.length, 5) - 1 ? (
                <span className="absolute left-[5px] top-4 h-[calc(100%+8px)] w-px bg-warm-border" />
              ) : null}
              <span
                className={`relative mt-1.5 h-3 w-3 shrink-0 rounded-full border-2 border-white ${
                  event.tone === "green"
                    ? "bg-[var(--warm-green)]"
                    : event.tone === "orange"
                      ? "bg-orange"
                      : "bg-ink-3"
                }`}
              />
              <div>
                <p className="text-xs font-bold leading-5 text-ink">{event.title}</p>
                <p className="mt-0.5 text-[11px] leading-4 text-ink-3">{event.detail}</p>
                <p className="mt-1 font-mono text-[10px] text-ink-4">{event.time}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4 rounded-[20px] border border-dashed border-orange/30 bg-orange-soft/45 p-4">
        <div className="flex items-center gap-2 text-xs font-bold text-orange-deep">
          <V2Icon name="sparkles" className="h-4 w-4" />
          原型操作提示
        </div>
        <p className="mt-2 text-[11px] leading-5 text-ink-2">
          可直接點左側步驟巡覽，或使用畫面主要按鈕走完完整狀態轉移。
        </p>
      </div>
    </aside>
  );
}

function MobileBottomNav({ state, dispatch }: ShellProps) {
  return (
    <nav
      aria-label="手機示範導覽"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-warm-border bg-white/95 px-3 pb-[calc(env(safe-area-inset-bottom)+8px)] pt-2 backdrop-blur-xl md:hidden"
    >
      <div className="mx-auto grid max-w-[430px] grid-cols-4">
        {mobileSteps.map((step) => {
          const active = step.id === state.currentStep;
          return (
            <button
              key={step.id}
              type="button"
              aria-current={active ? "page" : undefined}
              onClick={() => dispatch({ type: "NAVIGATE", step: step.id })}
              className={`flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-xl text-[10px] font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange ${
                active ? "text-orange-deep" : "text-ink-3"
              }`}
            >
              <V2Icon name={step.icon} className={`h-5 w-5 ${active ? "stroke-[2.2]" : ""}`} />
              {step.shortLabel}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

interface ShellProps {
  state: DemoState;
  dispatch: Dispatch<DemoAction>;
}

export function DemoShell({
  state,
  dispatch,
  children,
}: ShellProps & { children: ReactNode }) {
  return (
    <div className="relative left-1/2 min-h-dvh w-screen -translate-x-1/2 overflow-x-hidden bg-[#f8f2e9] text-ink">
      <a
        href="#demo-main"
        className="fixed left-4 top-3 z-[60] -translate-y-20 rounded-lg bg-ink px-4 py-2 text-sm font-bold text-white focus:translate-y-0"
      >
        跳到主要內容
      </a>
      <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden="true">
        <div className="absolute -right-24 -top-28 h-80 w-80 rounded-full bg-orange/10 blur-3xl" />
        <div className="absolute -bottom-32 left-1/4 h-96 w-96 rounded-full bg-brick/7 blur-3xl" />
      </div>

      <div className="relative md:grid md:grid-cols-[240px_minmax(0,1fr)]">
        <DesktopSidebar state={state} dispatch={dispatch} />

        <div className="min-w-0">
          <header className="sticky top-0 z-30 border-b border-warm-border/80 bg-[#f8f2e9]/92 backdrop-blur-xl">
            <div className="mx-auto flex min-h-[72px] max-w-[1180px] items-center gap-3 px-4 sm:px-6 lg:px-8">
              <div className="md:hidden">
                <BrandMark />
              </div>
              <div className="hidden min-w-0 flex-1 md:block">
                <p className="truncate text-sm font-bold text-ink">
                  {state.template === "service" ? "安心工程・到府服務模板" : "滴水不漏・小型工程模板"}
                </p>
                <p className="mt-0.5 truncate text-xs text-ink-3">
                  {state.activeRole === "technician" ? "技師現場模式" : "老闆／派工工作台"}・{getCaseStage(state)}
                </p>
              </div>

              <div className="ml-auto flex items-center gap-2">
                <label className="hidden items-center gap-2 rounded-xl border border-warm-border bg-white px-3 py-2 text-xs font-bold text-ink-2 sm:flex">
                  <span>QA 狀態</span>
                  <select
                    aria-label="預覽桌面畫面狀態"
                    value={state.viewState}
                    onChange={(event) =>
                      dispatch({
                        type: "SET_VIEW_STATE",
                        viewState: event.target.value as DemoState["viewState"],
                      })
                    }
                    className="min-h-7 bg-transparent text-xs text-orange-deep outline-none"
                  >
                    <option value="ready">正常</option>
                    <option value="loading">載入</option>
                    <option value="empty">空白</option>
                    <option value="error">錯誤</option>
                  </select>
                </label>
                <button
                  type="button"
                  onClick={() =>
                    dispatch({
                      type: "SET_ROLE",
                      role: state.activeRole === "technician" ? "dispatcher" : "technician",
                    })
                  }
                  className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-warm-border bg-white px-3 text-xs font-bold text-ink-2 transition hover:border-orange/40 hover:text-orange-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange"
                >
                  <V2Icon name={state.activeRole === "technician" ? "briefcase" : "wrench"} className="h-4 w-4" />
                  <span className="hidden sm:inline">
                    {state.activeRole === "technician" ? "回派工台" : "技師模式"}
                  </span>
                </button>
                <V2Button
                  variant="quiet"
                  icon="refresh"
                  className="hidden lg:inline-flex"
                  onClick={() => dispatch({ type: "RESET" })}
                >
                  重新開始
                </V2Button>
              </div>
            </div>
          </header>

          <div className="mx-auto grid max-w-[1180px] gap-8 px-4 pb-28 pt-5 sm:px-6 md:pb-10 lg:px-8 xl:grid-cols-[minmax(0,1fr)_300px]">
            <main id="demo-main" className="min-w-0">
              <div className="mb-4 flex items-center justify-between gap-3 rounded-2xl border border-orange/15 bg-orange-soft/60 px-3.5 py-2.5">
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-orange text-white">
                    <V2Icon name="sparkles" className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-xs font-bold text-orange-deep">互動原型 · 示範資料</p>
                    <p className="truncate text-[10px] text-ink-3">所有操作只保存在這個頁面，不會真的發送</p>
                  </div>
                </div>
                <div className="sm:hidden">
                  <select
                    aria-label="預覽畫面狀態"
                    value={state.viewState}
                    onChange={(event) =>
                      dispatch({
                        type: "SET_VIEW_STATE",
                        viewState: event.target.value as DemoState["viewState"],
                      })
                    }
                    className="min-h-9 rounded-lg border border-orange/20 bg-white px-2 text-[11px] font-bold text-orange-deep"
                  >
                    <option value="ready">正常</option>
                    <option value="loading">載入</option>
                    <option value="empty">空白</option>
                    <option value="error">錯誤</option>
                  </select>
                </div>
              </div>

              <div className="mb-4 rounded-2xl border border-warm-border bg-white p-3 md:hidden">
                <TemplateSwitch state={state} dispatch={dispatch} />
              </div>

              <FlowRail state={state} dispatch={dispatch} />
              <div className="mt-5">{children}</div>
            </main>

            <ContextRail state={state} />
          </div>
        </div>
      </div>

      <MobileBottomNav state={state} dispatch={dispatch} />
    </div>
  );
}
