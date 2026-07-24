import { getConfirmedTotal } from "@/lib/v2-demo/store";

import { V2Icon } from "./icons";
import {
  SectionHeading,
  StatusBadge,
  V2Button,
  V2Card,
  formatDemoMoney,
} from "./primitives";
import type { DemoScreenProps } from "./screen-types";

export function CompleteScreen({ state, dispatch }: DemoScreenProps) {
  if (state.workOrder.status !== "completed") {
    return (
      <div className="space-y-5">
        <header>
          <StatusBadge tone="neutral">尚未完成</StatusBadge>
          <h1 className="mt-2 text-[27px] font-black tracking-[-0.04em] text-ink">完工摘要</h1>
          <p className="mt-1 text-sm text-ink-3">只有正式完成必要紀錄後，才會產生這份摘要。</p>
        </header>
        <V2Card className="flex min-h-[370px] flex-col items-center justify-center px-6 py-12 text-center">
          <span className="inline-flex h-16 w-16 items-center justify-center rounded-[22px] bg-bg-warm text-ink-3">
            <V2Icon name="file" className="h-7 w-7" />
          </span>
          <h2 className="mt-5 text-xl font-black text-ink">尚未完成這張工單</h2>
          <p className="mt-2 max-w-sm text-sm leading-6 text-ink-3">
            先用技師模式完成狀態、檢查表與施工前後照，再送出完工。
          </p>
          <V2Button
            className="mt-6"
            icon="wrench"
            onClick={() => dispatch({ type: "NAVIGATE", step: "field" })}
          >
            回到技師現場
          </V2Button>
        </V2Card>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <header>
        <div className="flex items-center gap-2">
          <StatusBadge tone="green">流程完成</StatusBadge>
          <span className="font-mono text-xs text-ink-3">{state.workOrder.reference}</span>
        </div>
        <h1 className="mt-2 text-[27px] font-black tracking-[-0.04em] text-ink">完工摘要</h1>
        <p className="mt-1 text-sm text-ink-3">從 LINE 進件到現場證據，現在是一條可追蹤的完整紀錄。</p>
      </header>

      <V2Card className="overflow-hidden border-[var(--warm-green)]/20">
        <div className="relative overflow-hidden bg-[linear-gradient(135deg,#1c3b30_0%,#2e7d5b_100%)] px-5 py-7 text-white">
          <div className="absolute -right-12 -top-16 h-44 w-44 rounded-full bg-white/10" aria-hidden="true" />
          <div className="relative flex items-start gap-4">
            <span className="inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-[20px] bg-white text-[var(--warm-green)] shadow-xl shadow-black/10">
              <V2Icon name="check" className="h-7 w-7 stroke-[2.3]" />
            </span>
            <div>
              <p className="text-xs font-bold text-white/65">已安全完成</p>
              <h2 className="mt-1 text-xl font-black">{state.caseRecord.title}</h2>
              <p className="mt-1.5 text-sm text-white/70">
                {state.caseRecord.customerName}・{state.caseRecord.district}
              </p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-3 divide-x divide-warm-border p-5 text-center">
          <div className="px-2">
            <p className="font-mono text-sm font-black text-ink">{formatDemoMoney(getConfirmedTotal(state))}</p>
            <p className="mt-1 text-[10px] text-ink-3">確認金額</p>
          </div>
          <div className="px-2">
            <p className="font-mono text-sm font-black text-ink">{state.checklist.length}/{state.checklist.length}</p>
            <p className="mt-1 text-[10px] text-ink-3">檢查完成</p>
          </div>
          <div className="px-2">
            <p className="font-mono text-sm font-black text-ink">{state.photos.filter((photo) => photo.added).length}</p>
            <p className="mt-1 text-[10px] text-ink-3">證據照片</p>
          </div>
        </div>
      </V2Card>

      <V2Card className="p-5">
        <SectionHeading
          eyebrow="Before / after"
          title="施工證據"
          description="客戶版只會顯示被標記可公開的內容。"
        />
        <div className="mt-4 grid grid-cols-2 gap-3">
          {state.photos.map((photo) => (
            <div
              key={photo.id}
              className={`relative aspect-[4/3] overflow-hidden rounded-2xl ${
                photo.kind === "before"
                  ? "bg-[linear-gradient(145deg,#d4c2ac_0%,#8c7159_55%,#4b3c31_100%)]"
                  : "bg-[linear-gradient(145deg,#f1eee8_0%,#a8c4bf_55%,#547871_100%)]"
              }`}
            >
              <div className="absolute left-[18%] top-[18%] h-[45%] w-[64%] rounded-lg border-4 border-white/40 bg-black/10" />
              <span className="absolute inset-x-2 bottom-2 rounded-lg bg-black/45 px-2 py-1.5 text-center text-xs font-bold text-white backdrop-blur">
                {photo.label}示意
              </span>
            </div>
          ))}
        </div>
      </V2Card>

      <V2Card className="p-5">
        <SectionHeading title="完成內容" description="檢查表與時間都留在同一張工單" />
        <ul className="mt-4 space-y-2.5">
          {state.checklist.map((item) => (
            <li key={item.id} className="flex items-center gap-3 rounded-2xl bg-[#fbf8f3] px-3.5 py-3">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-[var(--warm-green-soft)] text-[var(--warm-green)]">
                <V2Icon name="check" className="h-4 w-4" />
              </span>
              <span className="text-sm font-bold text-ink">{item.label}</span>
            </li>
          ))}
        </ul>
      </V2Card>

      <V2Card className="p-5">
        <SectionHeading title="可稽核時間線" description="一般成員不能刪除重要商業事件" />
        <div className="mt-4 space-y-4">
          {state.timeline.map((event, index) => (
            <div key={event.id} className="relative flex gap-3">
              {index < state.timeline.length - 1 ? (
                <span className="absolute left-[5px] top-4 h-[calc(100%+8px)] w-px bg-warm-border" />
              ) : null}
              <span
                className={`relative mt-1.5 h-3 w-3 shrink-0 rounded-full border-2 border-white ${
                  event.tone === "green" ? "bg-[var(--warm-green)]" : "bg-orange"
                }`}
              />
              <div>
                <p className="text-sm font-bold text-ink">{event.title}</p>
                <p className="mt-0.5 text-xs leading-5 text-ink-3">{event.detail}</p>
                <p className="mt-1 font-mono text-[10px] text-ink-4">{event.time}</p>
              </div>
            </div>
          ))}
        </div>
      </V2Card>

      <div className="grid gap-2.5 sm:grid-cols-2">
        <V2Button variant="secondary" icon="briefcase" onClick={() => dispatch({ type: "NAVIGATE", step: "case" })}>
          回案件查看
        </V2Button>
        <V2Button icon="refresh" onClick={() => dispatch({ type: "RESET" })}>
          重新播放示範
        </V2Button>
      </div>
    </div>
  );
}

