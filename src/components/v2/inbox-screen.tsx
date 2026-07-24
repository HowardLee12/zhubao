import { V2Icon } from "./icons";
import {
  DemoAvatar,
  MetaRow,
  SectionHeading,
  StatusBadge,
  V2Button,
  V2Card,
} from "./primitives";
import type { DemoScreenProps } from "./screen-types";

export function InboxScreen({ state, dispatch }: DemoScreenProps) {
  const { caseRecord } = state;

  return (
    <div className="space-y-5">
      <header className="flex items-end justify-between gap-4">
        <div>
          <p className="text-xs font-bold text-orange-deep">今天，7 月 16 日</p>
          <h1 className="mt-1 text-[28px] font-black tracking-[-0.04em] text-ink">接案匣</h1>
          <p className="mt-1 text-sm text-ink-3">先處理最久未回覆的需求，不讓詢問沉到 LINE 底下。</p>
        </div>
        <span className="inline-flex h-11 min-w-11 items-center justify-center rounded-2xl bg-ink px-3 font-mono text-sm font-bold text-white">
          03
          <span className="sr-only">三筆待處理</span>
        </span>
      </header>

      <div className="grid grid-cols-3 gap-2.5" aria-label="接案摘要">
        {[
          { value: "3", label: "待回覆", tone: "text-orange-deep", bg: "bg-orange-soft" },
          { value: "1", label: "待補資料", tone: "text-[#2e5f9f]", bg: "bg-[#e6effc]" },
          { value: "18分", label: "最久等待", tone: "text-ink", bg: "bg-white" },
        ].map((stat) => (
          <div
            key={stat.label}
            className={`rounded-2xl border border-warm-border/70 px-3 py-3.5 ${stat.bg}`}
          >
            <p className={`font-mono text-lg font-black tracking-tight ${stat.tone}`}>{stat.value}</p>
            <p className="mt-0.5 text-[11px] font-semibold text-ink-3">{stat.label}</p>
          </div>
        ))}
      </div>

      <SectionHeading
        eyebrow="Next action"
        title="現在最值得處理"
        description="依等待時間與服務急迫性排序"
        right={<StatusBadge tone="orange">未回覆 18 分鐘</StatusBadge>}
      />

      <V2Card className="overflow-hidden">
        <div className="border-b border-warm-border bg-[linear-gradient(135deg,#fff8ed_0%,#fbe5d4_100%)] px-5 py-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-[#06c755] text-white">
                <V2Icon name="line" className="h-[18px] w-[18px]" />
              </span>
              <div>
                <p className="text-xs font-bold text-ink">LINE 官方帳號</p>
                <p className="font-mono text-[10px] text-ink-3">{caseRecord.receivedAt}</p>
              </div>
            </div>
            <StatusBadge tone="red">需要回覆</StatusBadge>
          </div>
        </div>

        <div className="p-5">
          <div className="flex items-start gap-3.5">
            <DemoAvatar initial={caseRecord.customerInitial} size="lg" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-black tracking-tight text-ink">{caseRecord.customerName}</h2>
                <StatusBadge tone={state.template === "service" ? "blue" : "purple"}>
                  {caseRecord.serviceLabel}
                </StatusBadge>
              </div>
              <p className="mt-1 text-xs font-semibold text-ink-3">{caseRecord.reference}</p>
            </div>
          </div>

          <p className="mt-4 text-[15px] font-bold leading-6 text-ink">{caseRecord.title}</p>
          <p className="mt-1.5 text-sm leading-6 text-ink-2">{caseRecord.summary}</p>

          <div className="mt-4 space-y-2.5 rounded-2xl bg-[#fbf8f3] p-3.5">
            <MetaRow icon="location">{caseRecord.district}</MetaRow>
            <MetaRow icon="clock">{caseRecord.details[1]}</MetaRow>
            <MetaRow icon="image">客戶已附 {caseRecord.photoCount} 張現況照片</MetaRow>
          </div>

          <div className="mt-4 flex gap-2" aria-label="客戶提供的照片示意">
            {["全景", "銘牌", "現況"].slice(0, Math.min(caseRecord.photoCount, 3)).map((label, index) => (
              <div
                key={label}
                className={`relative aspect-square min-w-0 flex-1 overflow-hidden rounded-xl border border-white/70 ${
                  index === 0
                    ? "bg-[linear-gradient(145deg,#d9c4aa,#8c765f)]"
                    : index === 1
                      ? "bg-[linear-gradient(145deg,#e9e5df,#9ea09c)]"
                      : "bg-[linear-gradient(145deg,#c4d2d0,#617b79)]"
                }`}
              >
                <span className="absolute inset-x-2 bottom-2 rounded-md bg-black/45 px-1.5 py-1 text-center text-[10px] font-bold text-white backdrop-blur">
                  {label}示意
                </span>
              </div>
            ))}
          </div>

          <div className="mt-5 flex flex-col gap-2 sm:flex-row">
            <V2Button
              icon="arrow"
              className="w-full sm:flex-1"
              onClick={() => dispatch({ type: "PROCESS_INTAKE" })}
            >
              整理這筆進件
            </V2Button>
            <V2Button variant="secondary" icon="phone" className="w-full sm:w-auto">
              聯絡客戶
            </V2Button>
          </div>
        </div>
      </V2Card>

      <div className="rounded-2xl border border-dashed border-warm-border-strong bg-white/50 px-4 py-3 text-xs leading-5 text-ink-3">
        <span className="font-bold text-ink-2">原型說明：</span>
        正式版會保留原始訊息與照片；AI 只能整理草稿，不能自行承諾價格或診斷。
      </div>
    </div>
  );
}

