import { getQuoteTotal } from "@/lib/v2-demo/store";

import { V2Icon } from "./icons";
import {
  DemoAvatar,
  MetaRow,
  SectionHeading,
  StatusBadge,
  V2Button,
  V2Card,
  formatDemoMoney,
} from "./primitives";
import type { DemoScreenProps } from "./screen-types";

export function DispatchScreen({ state, dispatch }: DemoScreenProps) {
  if (state.quote.status !== "accepted") {
    return (
      <div className="space-y-5">
        <header>
          <StatusBadge tone="orange">守門條件</StatusBadge>
          <h1 className="mt-2 text-[27px] font-black tracking-[-0.04em] text-ink">安排工單</h1>
          <p className="mt-1 text-sm text-ink-3">報價接受後，才能把承諾的範圍轉成交付任務。</p>
        </header>
        <V2Card className="flex min-h-[360px] flex-col items-center justify-center px-6 py-12 text-center">
          <span className="inline-flex h-16 w-16 items-center justify-center rounded-[22px] bg-orange-soft text-orange-deep">
            <V2Icon name="lock" className="h-7 w-7" />
          </span>
          <h2 className="mt-5 text-xl font-black text-ink">還不能派工</h2>
          <p className="mt-2 max-w-sm text-sm leading-6 text-ink-3">
            先由店內人工核准報價，再模擬客戶接受。這個守門條件不只存在畫面，也會由正式 API 驗證。
          </p>
          <V2Button
            className="mt-6"
            icon="quote"
            onClick={() => dispatch({ type: "NAVIGATE", step: "quote" })}
          >
            回到報價確認
          </V2Button>
        </V2Card>
      </div>
    );
  }

  const selectedTechnician = state.technicians.find(
    (technician) => technician.id === state.workOrder.assigneeId,
  );

  return (
    <div className="space-y-5">
      <header>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone="green">報價已接受</StatusBadge>
          <span className="font-mono text-xs font-semibold text-ink-3">
            {formatDemoMoney(getQuoteTotal(state))}
          </span>
        </div>
        <h1 className="mt-2 text-[27px] font-black tracking-[-0.04em] text-ink">安排工單</h1>
        <p className="mt-1 text-sm leading-6 text-ink-3">
          把服務日期、現場資訊與負責技師放進同一張可交接任務。
        </p>
      </header>

      <V2Card className="overflow-hidden">
        <div className="border-b border-warm-border bg-[#fffaf3] p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-orange-deep">
                Work order draft
              </p>
              <h2 className="mt-1 text-lg font-black text-ink">{state.workOrder.title}</h2>
              <p className="mt-1 font-mono text-[11px] text-ink-3">{state.workOrder.reference}</p>
            </div>
            <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-orange-soft text-orange-deep">
              <V2Icon name="briefcase" />
            </span>
          </div>
        </div>
        <div className="grid gap-5 p-5 sm:grid-cols-2">
          <div className="space-y-3">
            <MetaRow icon="calendar">{state.workOrder.dateLabel}</MetaRow>
            <MetaRow icon="clock">
              {state.workOrder.timeWindow}・{state.workOrder.duration}
            </MetaRow>
            <MetaRow icon="location">{state.caseRecord.address}</MetaRow>
          </div>
          <div className="rounded-2xl bg-[#fbf8f3] p-4">
            <p className="text-xs font-bold text-ink">技師可見摘要</p>
            <p className="mt-1.5 text-xs leading-5 text-ink-3">
              客戶稱呼、服務地址、內容、時段與現場注意事項；不含成本、毛利與全店客戶資料。
            </p>
          </div>
        </div>
      </V2Card>

      <V2Card className="p-5">
        <SectionHeading
          eyebrow="Assignee"
          title="選擇負責技師"
          description="有衝突的時段要先處理，不能靜默覆寫。"
        />
        <div className="mt-4 grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="選擇負責技師">
          {state.technicians.map((technician) => {
            const selected = technician.id === state.workOrder.assigneeId;
            return (
              <button
                key={technician.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => dispatch({ type: "SET_ASSIGNEE", technicianId: technician.id })}
                className={`flex min-h-[92px] items-center gap-3 rounded-2xl border p-3.5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange ${
                  selected
                    ? "border-orange bg-orange-soft/60"
                    : "border-warm-border bg-white hover:border-orange/35"
                }`}
              >
                <DemoAvatar
                  initial={technician.initial}
                  tone={selected ? "orange" : "ink"}
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-black text-ink">{technician.name}</span>
                  <span className="mt-0.5 block text-[11px] text-ink-3">{technician.specialty}</span>
                  <span
                    className={`mt-1 block text-[10px] font-semibold ${
                      technician.hasConflict ? "text-[var(--warm-red)]" : "text-[var(--warm-green)]"
                    }`}
                  >
                    {technician.availability}
                  </span>
                </span>
                <span
                  aria-hidden="true"
                  className={`h-4 w-4 rounded-full border-2 ${
                    selected ? "border-orange bg-orange shadow-[inset_0_0_0_3px_white]" : "border-warm-border-strong"
                  }`}
                />
              </button>
            );
          })}
        </div>

        {selectedTechnician?.hasConflict ? (
          <div role="alert" className="mt-4 flex items-start gap-2.5 rounded-2xl bg-[var(--warm-red-soft)] p-3.5 text-sm font-semibold leading-5 text-[var(--warm-red)]">
            <V2Icon name="alert" className="mt-0.5 h-4 w-4 shrink-0" />
            <span>李師傅在 14:00–16:00 已有工單；原型會阻擋這次派工。</span>
          </div>
        ) : (
          <div className="mt-4 flex items-center gap-2.5 rounded-2xl bg-[var(--warm-green-soft)] p-3.5 text-sm font-semibold text-[var(--warm-green)]">
            <V2Icon name="check" className="h-4 w-4" />
            此時段沒有衝突，可以派工
          </div>
        )}

        <V2Button
          className="mt-4 w-full"
          icon="send"
          onClick={() => dispatch({ type: "SCHEDULE_WORK_ORDER" })}
        >
          確認派工並切換技師模式
        </V2Button>
      </V2Card>

      <div className="flex items-start gap-3 rounded-2xl border border-dashed border-warm-border-strong bg-white/55 p-4">
        <V2Icon name="shield" className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" />
        <p className="text-xs leading-5 text-ink-3">
          正式版的排程儲存與 LINE 通知是兩個狀態；通知失敗不會把已排好的工單退回。
        </p>
      </div>
    </div>
  );
}

